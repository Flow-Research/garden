import { createFileRoute } from '@tanstack/react-router'
import { getConnectorById } from '@garden/connectors'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  connectionGrantBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/connections'
import {
  badRequest,
  json,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  removeConnectionGrant,
  setConnectionGrant,
} from '@/lib/server/connections/connection-grant-service'

/**
 * Connection-level grant PATCH/DELETE. Auth + Zod + permissionManage here;
 * grant writes live in connection-grant-service / queries/connections.
 */
export const Route = createFileRoute('/api/connections/$connectorId/grant')({
  server: {
    handlers: {
      PATCH: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId,
          permissions: workspacePermissions.permissionManage,
        })
        if (permission) return permission

        const connector = getConnectorById(params.connectorId)
        if (!connector) {
          return notFound('Connector not found')
        }

        const payloadResult = await parseJsonBody(
          request,
          connectionGrantBodySchema,
          'Invalid permission grant payload',
        )
        if (payloadResult.isErr()) {
          return badRequest(payloadResult.error.message)
        }

        // Reject before opening db — connection-scope auto is never valid.
        if (payloadResult.value.trustLevel === 'auto') {
          return badRequest(
            'Auto trust is only available for individual read tools',
          )
        }

        const result = await setConnectionGrant({
          db: await appContext.db(),
          workspaceId,
          agentId: payloadResult.value.agentId,
          connectorId: params.connectorId,
          trustLevel: payloadResult.value.trustLevel,
          grantedBy: session.user.id,
        })
        return result.match({
          ok: (value) => Response.json(value),
          err: (error) =>
            error.status === 404
              ? notFound(error.message)
              : error.status === 400
                ? badRequest(error.message)
                : json({ error: error.message }, error.status),
        })
      },
      DELETE: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId,
          permissions: workspacePermissions.permissionManage,
        })
        if (permission) return permission

        const connector = getConnectorById(params.connectorId)
        if (!connector) {
          return notFound('Connector not found')
        }

        const bodyResult = await parseJsonBody(
          request,
          connectionGrantBodySchema.pick({ agentId: true }),
          'Invalid permission grant payload',
        )
        if (bodyResult.isErr()) {
          return badRequest(bodyResult.error.message)
        }

        const result = await removeConnectionGrant({
          db: await appContext.db(),
          workspaceId,
          agentId: bodyResult.value.agentId,
          connectorId: params.connectorId,
          actorId: session.user.id,
        })
        return result.match({
          ok: (value) => Response.json(value),
          err: (error) =>
            error.status === 404
              ? notFound(error.message)
              : json({ error: error.message }, error.status),
        })
      },
    },
  },
})
