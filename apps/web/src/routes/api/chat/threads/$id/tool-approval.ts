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
import { resolveConnectorWritePermissionRequests } from '@/lib/server/permission-request'
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
        if (permission) return permission

        const { approved, permission_request_id: permissionRequestId } =
          bodyResult.value

        if (permissionRequestId) {
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

        const resolutionResult = await resolveConnectorWritePermissionRequests({
          approved,
          actorUserId: access.session.user.id,
          db: access.db,
          toolCallId,
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

        return Response.json({
          ok: true,
          toolCallIds: resolutionResult.value.toolCallIds,
        })
      },
    },
  },
})
