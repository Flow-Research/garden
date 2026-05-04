import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import {
  getActiveIssueRun,
  listIssueRunEvents,
  listIssueWorkProducts,
  type IssueRunServiceError,
} from '@/lib/server/issue-run'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/active-run')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(request, issue.workspaceId)
        if (access instanceof Response) return access

        const runResult = await getActiveIssueRun({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runResult.isErr()) return runError(runResult.error)

        const workProductsResult = await listIssueWorkProducts({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (workProductsResult.isErr()) return runError(workProductsResult.error)

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
          work_products: workProductsResult.value,
          events,
        })
      },
    },
  },
})
