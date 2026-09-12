import { Result, TaggedError } from 'better-result'
import { and, eq } from 'drizzle-orm'
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
import { schema } from '@/lib/server/db'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

class ConnectorGrantRouteError extends TaggedError('ConnectorGrantRouteError')<{
  status: number
  message: string
}>() {}

export const Route = createFileRoute('/api/connections/$connectorId/grant')({
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

        if (payloadResult.value.trustLevel === 'auto') {
          return badRequest(
            'Auto trust is only available for individual read tools',
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
            new ConnectorGrantRouteError({
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

        const grantedAt = new Date()
        const mutationResult = await Result.tryPromise({
          try: async () =>
            db.transaction(async (tx) => {
              await tx
                .insert(schema.connectionGrant)
                .values({
                  id: crypto.randomUUID(),
                  agentId: payloadResult.value.agentId,
                  connectorId: params.connectorId,
                  trustLevel: payloadResult.value.trustLevel,
                  grantedBy: session.user.id,
                  grantedAt,
                  expiresAt: null,
                })
                .onConflictDoUpdate({
                  target: [
                    schema.connectionGrant.agentId,
                    schema.connectionGrant.connectorId,
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
                  scope: 'connection',
                  connector_id: params.connectorId,
                  trust: payloadResult.value.trustLevel,
                },
              })
            }),
          catch: () =>
            new ConnectorGrantRouteError({
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
            new ConnectorGrantRouteError({
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
              const deleted = await tx
                .delete(schema.connectionGrant)
                .where(
                  and(
                    eq(
                      schema.connectionGrant.agentId,
                      bodyResult.value.agentId,
                    ),
                    eq(schema.connectionGrant.connectorId, params.connectorId),
                  ),
                )
                .returning({ id: schema.connectionGrant.id })
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
                  scope: 'connection',
                  connector_id: params.connectorId,
                },
              })
            }),
          catch: () =>
            new ConnectorGrantRouteError({
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
