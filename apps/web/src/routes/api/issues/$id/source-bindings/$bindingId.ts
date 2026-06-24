import { and, eq } from 'drizzle-orm'
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
  removeSourceBinding,
  type IssueSourceBindingServiceError,
} from '@garden/core/issues/source-binding'

function sourceBindingError(error: IssueSourceBindingServiceError) {
  return error.code === 'binding_not_found'
    ? notFound(error.message)
    : badRequest(error.message)
}

export const Route = createFileRoute(
  '/api/issues/$id/source-bindings/$bindingId',
)({
  server: {
    handlers: {
      DELETE: async ({ context, params }) => {

        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [binding] = await db
          .select({ workspaceId: schema.issueSourceBinding.workspaceId })
          .from(schema.issueSourceBinding)
          .where(
            and(
              eq(schema.issueSourceBinding.id, params.bindingId),
              eq(schema.issueSourceBinding.issueId, params.id),
            ),
          )
          .limit(1)
        if (!binding) return notFound('Source binding not found')

        const access = await requireWorkspaceAccess(appContext, binding.workspaceId)
        if (access instanceof Response) return access

        const removeResult = await removeSourceBinding({
          databaseUrl: appEnv.HYPERDRIVE.connectionString,
          bindingId: params.bindingId,
        })
        if (removeResult.isErr()) return sourceBindingError(removeResult.error)
        return new Response(null, { status: 204 })
      },
    },
  },
})
