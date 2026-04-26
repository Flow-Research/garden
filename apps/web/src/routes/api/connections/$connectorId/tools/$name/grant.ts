import { Result, TaggedError } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  connectionGrantBodySchema,
  parseJsonBody,
} from '@/lib/server/api-validation'
import {
  badRequest,
  json,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'

type PermissionTrustLevel = 'auto' | 'allow' | 'ask'

class ConnectionGrantRouteError extends TaggedError('ConnectionGrantRouteError')<{
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
      PATCH: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const payloadResult = await parseGrantPayload(request)
        if (payloadResult.isErr()) {
          return json(
            { error: payloadResult.error.message },
            payloadResult.error.status,
          )
        }

        const db = getDb(appEnv)

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
          return json({ error: agentResult.error.message }, agentResult.error.status)
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
        const upsertResult = await Result.tryPromise({
          try: async () =>
            db
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
              }),
          catch: () =>
            new ConnectionGrantRouteError({
              status: 500,
              message: 'Failed to update permission grant',
            }),
        })
        if (upsertResult.isErr()) {
          return json(
            { error: upsertResult.error.message },
            upsertResult.error.status,
          )
        }

        return Response.json({ ok: true })
      },
    },
  },
})
