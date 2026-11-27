import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { appEnv } from '@/lib/server/env'
import { notFound } from '@/lib/server/control-plane'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import { requireIssueAccess } from '@/lib/server/issue-access'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { getIssueSourceBindingWorkspaceId } from '@/lib/server/queries/issues'
import { removeSourceBinding } from '@garden/server/issues/source-binding'

export const Route = createFileRoute(
  '/api/issues/$id/source-bindings/$bindingId',
)({
  server: {
    handlers: {
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const workspaceId = await getIssueSourceBindingWorkspaceId(access.db, {
          issueId: params.id,
          bindingId: params.bindingId,
        })
        if (!workspaceId) return notFound('Source binding not found')

        const permission = await requireWorkspacePermission({
          appContext,
          request: appContext.request,
          workspaceId,
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
