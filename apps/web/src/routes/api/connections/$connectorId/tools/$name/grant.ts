import { Result, TaggedError } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
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
import { schema } from '@/lib/server/db'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

type PermissionTrustLevel = 'auto' | 'allow' | 'ask'

class ConnectionGrantRouteError extends TaggedError(
  'ConnectionGrantRouteError',
)<{
  status: number
  message: string
}>() {}

async function parseGrantPayload(request: Request) {
  const bodyResult = await parseJsonBody(
    request,
    connectionGrantBodySchema,
    'Invalid permission grant payload',
  )
  if (bodyResult.isErr()) {
    return Result.err(
      new ConnectionGrantRouteError({
        status: 400,
        message: bodyResult.error.message,
      }),
    )
  }

  return Result.ok({
    agentId: bodyResult.value.agentId,
    trustLevel: bodyResult.value.trustLevel,
  } satisfies {
    agentId: string
    trustLevel: PermissionTrustLevel
  })
}

export const Route = createFileRoute(
  '/api/connections/$connectorId/tools/$name/grant',
)({
  server: {
    handlers: {
      PATCH: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
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

        const payloadResult = await parseGrantPayload(request)
        if (payloadResult.isErr()) {
          return json(
            { error: payloadResult.error.message },
            payloadResult.error.status,
          )
        }

        const db = await appContext.db()

        const agentResult = await Result.tryPromise({
          try: async () =>
            db
              .select({ id: schema.agent.id })
              .from(schema.agent)
              .where(
                and(
                  eq(schema.agent.id, payloadResult.value.agentId),
                  eq(schema.agent.workspaceId, workspaceId),
                ),
              )
              .limit(1),
          catch: () =>
            new ConnectionGrantRouteError({
              status: 500,
              message: 'Failed to load agent for permission grant',
            }),
        })
        if (agentResult.isErr()) {
          return json(
            { error: agentResult.error.message },
            agentResult.error.status,
          )
        }

        if (!agentResult.value[0]) {
          return notFound('Agent not found')
        }

        const capabilityResult = await Result.tryPromise({
          try: async () =>
            db
              .select({
                id: schema.capability.id,
                riskClass: schema.capability.riskClass,
              })
              .from(schema.capability)
              .where(
                and(
                  eq(schema.capability.connectorType, params.connectorId),
                  eq(schema.capability.name, params.name),
                ),
              )
              .limit(1),
          catch: () =>
            new ConnectionGrantRouteError({
              status: 500,
              message: 'Failed to load tool capability for permission grant',
            }),
        })
        if (capabilityResult.isErr()) {
          return json(
            { error: capabilityResult.error.message },
            capabilityResult.error.status,
          )
        }

        const capability = capabilityResult.value[0]
        if (!capability) {
          return notFound('Tool not found')
        }

        if (
          payloadResult.value.trustLevel === 'auto' &&
          capability.riskClass !== 'read'
        ) {
          return badRequest('Auto trust is only available for read tools')
        }

        const grantedAt = new Date()
        const mutationResult = await Result.tryPromise({
          try: async () =>
            db.transaction(async (tx) => {
              await tx
                .insert(schema.permissionGrant)
                .values({
                  id: crypto.randomUUID(),
                  agentId: payloadResult.value.agentId,
                  capabilityId: capability.id,
                  trustLevel: payloadResult.value.trustLevel,
                  grantedBy: session.user.id,
                  grantedAt,
                  expiresAt: null,
                })
                .onConflictDoUpdate({
                  target: [
                    schema.permissionGrant.agentId,
                    schema.permissionGrant.capabilityId,
                  ],
                  set: {
                    trustLevel: payloadResult.value.trustLevel,
                    grantedBy: session.user.id,
                    grantedAt,
                    expiresAt: null,
                  },
                })
              await tx.insert(schema.activityEvent).values({
                id: crypto.randomUUID(),
                workspaceId,
                subjectType: 'agent',
                subjectId: payloadResult.value.agentId,
                actorType: 'user',
                actorId: session.user.id,
                eventType: 'permission.grant.set',
                payload: {
                  scope: 'tool',
                  connector_id: params.connectorId,
                  tool_name: params.name,
                  trust: payloadResult.value.trustLevel,
                },
              })
            }),
          catch: () =>
            new ConnectionGrantRouteError({
              status: 500,
              message: 'Failed to update permission grant',
            }),
        })
        if (mutationResult.isErr()) {
          return json(
            { error: mutationResult.error.message },
            mutationResult.error.status,
          )
        }

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
        return Response.json({ ok: true })
      },
      DELETE: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
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

        const db = await appContext.db()
        const agentResult = await Result.tryPromise({
          try: async () =>
            db
              .select({ id: schema.agent.id })
              .from(schema.agent)
              .where(
                and(
                  eq(schema.agent.id, bodyResult.value.agentId),
                  eq(schema.agent.workspaceId, workspaceId),
                ),
              )
              .limit(1),
          catch: () =>
            new ConnectionGrantRouteError({
              status: 500,
              message: 'Failed to load agent for permission grant',
            }),
        })
        if (agentResult.isErr()) {
          return json(
            { error: agentResult.error.message },
            agentResult.error.status,
          )
        }

        if (!agentResult.value[0]) {
          return notFound('Agent not found')
        }

        const deleteResult = await Result.tryPromise({
          try: async () =>
            db.transaction(async (tx) => {
              const [capability] = await tx
                .select({ id: schema.capability.id })
                .from(schema.capability)
                .where(
                  and(
                    eq(schema.capability.connectorType, params.connectorId),
                    eq(schema.capability.name, params.name),
                  ),
                )
                .limit(1)
              if (!capability) return
              const deleted = await tx
                .delete(schema.permissionGrant)
                .where(
                  and(
                    eq(
                      schema.permissionGrant.agentId,
                      bodyResult.value.agentId,
                    ),
                    eq(schema.permissionGrant.capabilityId, capability.id),
                  ),
                )
                .returning({ id: schema.permissionGrant.id })
              if (deleted.length === 0) return
              await tx.insert(schema.activityEvent).values({
                id: crypto.randomUUID(),
                workspaceId,
                subjectType: 'agent',
                subjectId: bodyResult.value.agentId,
                actorType: 'user',
                actorId: session.user.id,
                eventType: 'permission.grant.deleted',
                payload: {
                  scope: 'tool',
                  connector_id: params.connectorId,
                  tool_name: params.name,
                },
              })
            }),
          catch: () =>
            new ConnectionGrantRouteError({
              status: 500,
              message: 'Failed to delete permission grant',
            }),
        })
        if (deleteResult.isErr()) {
          return json(
            { error: deleteResult.error.message },
            deleteResult.error.status,
          )
        }

        return Response.json({ ok: true })
      },
    },
  },
})
