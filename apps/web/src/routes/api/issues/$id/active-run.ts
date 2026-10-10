
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'

import { appEnv } from '@/lib/server/env'
import {
  badRequest,
} from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import {
  getActiveIssueRun,
  listIssueRunEvents,
  type IssueRunServiceError,
} from '@garden/server/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/active-run')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
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

        const eventsResult = runResult.value
          ? await listIssueRunEvents({
              env: appEnv,
              workspaceId: issue.workspaceId,
              issueId: params.id,
              runId: runResult.value.id,
              limit: 50,
            })
          : null
        if (eventsResult?.isErr()) return runError(eventsResult.error)
        const events = eventsResult?.isOk() ? eventsResult.value : []

        return Response.json({
          run: runResult.value,
          work_products: [],
          events,
        })
      },
    },
  },
})
