import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { appEnv } from '@/lib/server/env'
import { badRequest, notFound } from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { agentExistsInWorkspace } from '@/lib/server/queries/issues'
import { listIssueRuns, startIssueRun } from '@garden/server/issues/run-service'

export const Route = createFileRoute('/api/issues/$id/runs')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const issue = access.issue

        const runsResult = await listIssueRuns({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runsResult.isErr()) return serviceErrorResponse(runsResult.error)
        return Response.json(runsResult.value)
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const issue = access.issue
        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId: issue.workspaceId,
          permissions: workspacePermissions.issueManage,
        })
        if (permission) return permission

        if (issue.assigneeType !== 'agent' || !issue.assigneeId) {
          return badRequest('Issue must be assigned to an agent to start a run')
        }

        const agentExists = await agentExistsInWorkspace(access.db, {
          workspaceId: issue.workspaceId,
          agentId: issue.assigneeId,
        })
        if (!agentExists) return notFound('Agent not found')

        const startResult = await startIssueRun(appEnv, {
          workspaceId: issue.workspaceId,
          issueId: issue.id,
          agentId: issue.assigneeId,
          source: 'manual',
          actor: { type: 'member', id: access.session.user.id },
        })
        if (startResult.isErr()) return serviceErrorResponse(startResult.error)
        return Response.json(startResult.value, { status: 202 })
      },
    },
  },
})
