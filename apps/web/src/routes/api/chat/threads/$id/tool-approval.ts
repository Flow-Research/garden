import { createFileRoute } from '@tanstack/react-router'
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
            return json(
              { error: proposalResult.error.message },
              proposalResult.error.status,
            )
          }

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
          return json(
            { error: resolutionResult.error.message },
            resolutionResult.error.status,
          )
        }

        return Response.json({
          ok: true,
          toolCallIds: resolutionResult.value.toolCallIds,
        })
      },
    },
  },
})
