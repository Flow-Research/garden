import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { archiveInboxItemsByKey } from '@garden/db/inbox'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  toolApprovalBodySchema,
} from '@/lib/server/validation/chat'
import { json } from '@/lib/server/control-plane'
import { getThreadAccess } from '@/lib/server/chat-threads'
import {
  readChatToolDecisions,
  resolveConnectorWritePermissionRequests,
  teamOwnerApprovalScope,
} from '@/lib/server/permission-request'
import { resolveAgentProposalRequest } from '@/lib/server/agent-proposal-request'
import { appEnv } from '@/lib/server/env'
import {
  capturePostHogEvent,
  capturePostHogHandledError,
} from '@/lib/posthog-server'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

export const Route = createFileRoute('/api/chat/threads/$id/tool-approval')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await getThreadAccess(appContext, params.id)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          toolApprovalBodySchema,
          'Invalid tool approval payload',
        )
        if (bodyResult.isErr()) {
          return json({ error: bodyResult.error.message }, 400)
        }
        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId: access.thread.workspaceId,
          permissions: workspacePermissions.permissionManage,
        })

        const { approved, permission_request_id: permissionRequestId } =
          bodyResult.value

        if (permissionRequestId) {
          if (permission) return permission
          const proposalResult = await resolveAgentProposalRequest({
            actorUserId: access.session.user.id,
            approved,
            db: access.db,
            env: appEnv,
            requestId: permissionRequestId,
            runActor: { type: 'agent', id: access.thread.agentId },
            workspaceId: access.thread.workspaceId,
          })
          if (proposalResult.isErr()) {
            capturePostHogHandledError(appContext, {
              distinctId: access.session.user.id,
              workspaceId: access.thread.workspaceId,
              error: proposalResult.error,
              properties: {
                operation: 'approval_resolve',
                approval_kind: 'agent_proposal',
                approval_id: permissionRequestId,
                thread_id: access.thread.id,
              },
            })
            return json(
              { error: proposalResult.error.message },
              proposalResult.error.status,
            )
          }

          capturePostHogEvent(appContext, {
            distinctId: access.session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.approvalResolved,
            workspaceId: access.thread.workspaceId,
            properties: {
              approval_id: proposalResult.value.permissionRequestId,
              approval_kind: 'agent_proposal',
              outcome: approved ? 'approved' : 'denied',
              pending_agent_id: proposalResult.value.pendingAgentId,
              source_issue_id: proposalResult.value.sourceIssueId,
              thread_id: access.thread.id,
            },
          })
          await archiveInboxItemsByKey({
            db: access.db,
            workspaceId: access.thread.workspaceId,
            itemKeys: [`approval:${proposalResult.value.permissionRequestId}`],
          })

          return Response.json({
            ok: true,
            permissionRequestIds: [proposalResult.value.permissionRequestId],
            pendingAgentId: proposalResult.value.pendingAgentId,
            sourceIssueId: proposalResult.value.sourceIssueId,
            invalidations: [
              'inbox',
              'agents',
              ...(proposalResult.value.sourceIssueId ? ['issues'] : []),
            ],
          })
        }

        const toolCallId = bodyResult.value.toolCallId
        if (!toolCallId) {
          return json({ error: 'Tool call id is required' }, 400)
        }

        const scope = {
          db: access.db,
          agentId: access.thread.agentId,
          threadId: access.thread.id,
          workspaceId: access.thread.workspaceId,
        }
        const existing = await readChatToolDecisions({
          ...scope,
          toolCallIds: [toolCallId],
        })
        if (existing.isErr())
          return json({ error: existing.error.message }, existing.error.status)
        const decision = existing.value.get(toolCallId)
        if (decision?.approved || decision?.denied) {
          if (approved !== decision.approved)
            return json(
              { error: 'Select the decision already recorded in the Inbox.' },
              409,
            )
          return Response.json({ ok: true, toolCallIds: [toolCallId] })
        }
        if (decision && decision.count > 1) {
          return json(
            {
              error:
                'Review the connector requests in the Inbox. Then return here and select the recorded decision to continue.',
            },
            409,
          )
        }

        // Workspace approvers decide any call. A Team owner decides only calls
        // their Team's agent policy held; other Team owners get 403.
        const teamScopeResult = permission
          ? await teamOwnerApprovalScope({
              db: access.db,
              workspaceId: access.thread.workspaceId,
              actorUserId: access.session.user.id,
              toolCallId,
              threadId: access.thread.id,
            })
          : Result.ok(null)
        if (teamScopeResult.isErr()) {
          return json(
            { error: teamScopeResult.error.message },
            teamScopeResult.error.status,
          )
        }
        if (permission && !teamScopeResult.value) return permission

        const resolutionResult = await resolveConnectorWritePermissionRequests({
          approved,
          actorUserId: access.session.user.id,
          db: access.db,
          toolCallId,
          threadId: access.thread.id,
          ...(teamScopeResult.value ? { teamId: teamScopeResult.value } : {}),
          workspaceId: access.thread.workspaceId,
        })
        if (resolutionResult.isErr()) {
          capturePostHogHandledError(appContext, {
            distinctId: access.session.user.id,
            workspaceId: access.thread.workspaceId,
            error: resolutionResult.error,
            properties: {
              operation: 'approval_resolve',
              approval_kind: 'connector_write',
              thread_id: access.thread.id,
              tool_call_id: toolCallId,
            },
          })
          return json(
            { error: resolutionResult.error.message },
            resolutionResult.error.status,
          )
        }

        for (const resolvedPermissionRequestId of resolutionResult.value
          .permissionRequestIds) {
          capturePostHogEvent(appContext, {
            distinctId: access.session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.approvalResolved,
            workspaceId: access.thread.workspaceId,
            properties: {
              approval_id: resolvedPermissionRequestId,
              approval_kind: 'connector_write',
              outcome: approved ? 'approved' : 'denied',
              batch_size: resolutionResult.value.permissionRequestIds.length,
              thread_id: access.thread.id,
              tool_call_id: toolCallId,
            },
          })
        }

        const recorded = await readChatToolDecisions({
          ...scope,
          toolCallIds: resolutionResult.value.toolCallIds,
        })
        if (recorded.isErr())
          return json({ error: recorded.error.message }, recorded.error.status)
        const readyCalls = [...recorded.value.values()]
          .filter((row) => (approved ? row.approved : row.denied))
          .map((row) => row.call)
        if (readyCalls.length === 0)
          return json(
            {
              error:
                'Review the remaining connector requests in the Inbox, then return here to continue.',
            },
            409,
          )
        return Response.json({ ok: true, toolCallIds: readyCalls })
      },
    },
  },
})
