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
  listIssueRunEvents,
  listIssueWorkProducts,
  toIssueRun,
  type IssueRunServiceError,
} from '@/lib/server/issue-run'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/runs/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [run] = await db
          .select()
          .from(schema.issueRun)
          .where(eq(schema.issueRun.id, params.id))
          .limit(1)
        if (!run) return notFound('Run not found')

        const access = await requireWorkspaceAccess(request, run.workspaceId)
        if (access instanceof Response) return access

        const eventsResult = await listIssueRunEvents({
          env: appEnv,
          workspaceId: run.workspaceId,
          runId: run.id,
          limit: 200,
        })
        if (eventsResult.isErr()) return runError(eventsResult.error)

        const workProductsResult = await listIssueWorkProducts({
          env: appEnv,
          workspaceId: run.workspaceId,
          issueId: run.issueId,
        })
        if (workProductsResult.isErr()) return runError(workProductsResult.error)

        return Response.json({
          run: toIssueRun(run),
          events: eventsResult.value,
          work_products: workProductsResult.value.filter(
            (workProduct) => workProduct.run_id === run.id,
          ),
        })
      },
    },
  },
})
