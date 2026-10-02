
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'

import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
} from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import {
  cancelIssueRun,
  getActiveIssueRun,
  type IssueRunServiceError,
} from '@garden/server/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/cancel')({
  server: {
    handlers: {
      POST: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
                const issue = access.issue

        const runResult = await getActiveIssueRun({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runResult.isErr()) return runError(runResult.error)
        if (!runResult.value) return notFound('Active run not found')

        const cancelResult = await cancelIssueRun(appEnv, {
          workspaceId: issue.workspaceId,
          runId: runResult.value.id,
          actor: { type: 'member', id: access.session.user.id },
          reason: 'user_cancelled',
        })
        if (cancelResult.isErr()) return runError(cancelResult.error)
        return Response.json({ ok: true })
      },
    },
  },
})
