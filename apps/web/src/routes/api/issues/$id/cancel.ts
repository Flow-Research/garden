import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { appEnv } from '@/lib/server/env'
import { notFound } from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  cancelIssueRun,
  getActiveIssueRun,
} from '@garden/server/issues/run-service'

export const Route = createFileRoute('/api/issues/$id/cancel')({
  server: {
    handlers: {
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

        const runResult = await getActiveIssueRun({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runResult.isErr()) return serviceErrorResponse(runResult.error)
        if (!runResult.value) return notFound('Active run not found')

        const cancelResult = await cancelIssueRun(appEnv, {
          workspaceId: issue.workspaceId,
          runId: runResult.value.id,
          actor: { type: 'member', id: access.session.user.id },
          reason: 'user_cancelled',
        })
        if (cancelResult.isErr())
          return serviceErrorResponse(cancelResult.error)
        return Response.json({ ok: true })
      },
    },
  },
})
