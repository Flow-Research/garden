import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  connectionGrantBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/connections'
import {
  badRequest,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  removeToolGrant,
  setToolGrant,
} from '@/lib/server/connections/tool-grant-service'
import { permissionGrantToResponse } from '@/lib/server/connections/grant-shared'

/**
 * Tool-level grant PATCH/DELETE. Auth + Zod + permissionManage here; writes
 * in tool-grant-service. PostHog after successful PATCH stays in the route.
 */
export const Route = createFileRoute(
  '/api/connections/$connectorId/tools/$name/grant',
)({
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

        const payloadResult = await parseJsonBody(
          request,
          connectionGrantBodySchema,
          'Invalid permission grant payload',
        )
        if (payloadResult.isErr()) {
          return badRequest(payloadResult.error.message)
        }

        const result = await setToolGrant({
          db: await appContext.db(),
          workspaceId,
          agentId: payloadResult.value.agentId,
          connectorId: params.connectorId,
          toolName: params.name,
          trustLevel: payloadResult.value.trustLevel,
          grantedBy: session.user.id,
        })
        return result.match({
          ok: (value) => {
            capturePostHogEvent(appContext, {
              distinctId: session.user.id,
              event: GARDEN_ANALYTICS_EVENTS.toolPermissionGranted,
              workspaceId,
              properties: {
                connector_id: params.connectorId,
                tool_name: params.name,
                agent_id: payloadResult.value.agentId,
                trust_level: payloadResult.value.trustLevel,
              },
            })
            return Response.json(value)
          },
          err: permissionGrantToResponse,
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

        const bodyResult = await parseJsonBody(
          request,
          connectionGrantBodySchema.pick({ agentId: true }),
          'Invalid permission grant payload',
        )
        if (bodyResult.isErr()) {
          return badRequest(bodyResult.error.message)
        }

        const result = await removeToolGrant({
          db: await appContext.db(),
          workspaceId,
          agentId: bodyResult.value.agentId,
          connectorId: params.connectorId,
          toolName: params.name,
          actorId: session.user.id,
        })
        return result.match({
          ok: (value) => Response.json(value),
          err: permissionGrantToResponse,
        })
      },
    },
  },
})
