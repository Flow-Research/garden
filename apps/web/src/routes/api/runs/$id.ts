import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import {
  IssueRunServiceError,
  listIssueRunEvents,
  listIssueWorkProducts,
  toIssueRun,
} from '@garden/server/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/runs/$id')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {

        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [run] = await db
          .select()
          .from(schema.issueRun)
          .where(eq(schema.issueRun.id, params.id))
          .limit(1)
        if (!run) return notFound('Run not found')

        const access = await requireWorkspaceAccess(appContext, run.workspaceId)
        if (access instanceof Response) return access

        const eventsResult = await listIssueRunEvents({
          env: appEnv,
          workspaceId: run.workspaceId,
          runId: run.id,
          limit: 200,
        })
        if (eventsResult.isErr()) return runError(eventsResult.error)

        const workProducts = await (async () => {
          if (!run.issueId) return []
          const wpResult = await listIssueWorkProducts({
            env: appEnv,
            workspaceId: run.workspaceId,
            issueId: run.issueId,
          })
          return wpResult.isOk() ? wpResult.value : null
        })()
        if (workProducts === null) {
          return runError(
            new IssueRunServiceError({
              code: 'db_error',
              message: 'Failed to load work products.',
            }),
          )
        }

        return Response.json({
          run: toIssueRun(run),
          events: eventsResult.value,
          work_products: workProducts.filter(
            (workProduct) => workProduct.run_id === run.id,
          ),
        })
      },
    },
  },
})
