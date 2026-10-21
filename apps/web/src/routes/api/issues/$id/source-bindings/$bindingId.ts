import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { removeSourceBinding } from '@garden/server/issues/source-binding'

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

        const access = await requireWorkspaceAccess(
          appContext,
          binding.workspaceId,
        )
        if (access instanceof Response) return access
        const permission = await requireWorkspacePermission({
          appContext,
          request: appContext.request,
          workspaceId: binding.workspaceId,
          permissions: workspacePermissions.issueManage,
        })
        if (permission) return permission

        const removeResult = await removeSourceBinding({
          databaseUrl: appEnv.HYPERDRIVE.connectionString,
          bindingId: params.bindingId,
        })
        if (removeResult.isErr())
          return serviceErrorResponse(removeResult.error)
        return new Response(null, { status: 204 })
      },
    },
  },
})
