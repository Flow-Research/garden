import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { appEnv } from '@/lib/server/env'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  getActiveIssueRun,
  listIssueRunEvents,
} from '@garden/server/issues/run-service'

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
        if (runResult.isErr()) return serviceErrorResponse(runResult.error)

        const eventsResult = runResult.value
          ? await listIssueRunEvents({
              env: appEnv,
              workspaceId: issue.workspaceId,
              issueId: params.id,
              runId: runResult.value.id,
              limit: 50,
            })
          : null
        if (eventsResult?.isErr())
          return serviceErrorResponse(eventsResult.error)
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
