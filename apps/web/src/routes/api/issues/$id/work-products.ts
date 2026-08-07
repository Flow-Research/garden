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
  listIssueWorkProducts,
  type IssueRunServiceError,
} from '@garden/server/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/work-products')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          appContext,
          issue.workspaceId,
        )
        if (access instanceof Response) return access

        const workProductsResult = await listIssueWorkProducts({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (workProductsResult.isErr())
          return runError(workProductsResult.error)

        return Response.json(workProductsResult.value)
      },
    },
  },
})
