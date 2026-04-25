import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getConnectorById } from '@garden/connectors'
import { syncCapabilities } from '@/lib/server/capability-sync'
import {
  badRequest,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'

function syncErrorStatus(code: string) {
  switch (code) {
    case 'connector_not_found':
      return 404
    case 'sync_agent_not_found':
    case 'unclassified_tool':
      return 409
    default:
      return 500
  }
}

async function parseAction(request: Request) {
  const bodyResult = await Result.tryPromise({
    try: async () => (await request.json()) as Record<string, unknown>,
    catch: () => null,
  })

  if (bodyResult.isErr()) {
    return Result.err('invalid-body')
  }

  const action = bodyResult.value?.action
  return action === 'disconnect' || action === 'resync'
    ? Result.ok(action)
    : Result.err('invalid-action')
}

export const Route = createFileRoute('/api/connections/$connectorId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return Response.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const connector = getConnectorById(params.connectorId)
        if (!connector) return notFound('Connector not found')

        const actionResult = await parseAction(request)
        if (actionResult.isErr()) {
          return badRequest('Invalid connection action')
        }

        const db = getDb(appEnv)

        if (actionResult.value === 'disconnect') {
          if (!connector.oauth) {
            return badRequest('Connector does not support disconnect')
          }

          const [connection] = await db
            .update(schema.account)
            .set({
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
              scope: null,
              scopes: [],
              status: 'disconnected',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.account.userId, session.user.id),
                eq(schema.account.workspaceId, workspaceId),
                eq(schema.account.providerId, connector.oauth.providerId),
              ),
            )
            .returning({ id: schema.account.id })

          return connection
            ? Response.json({ ok: true })
            : notFound('Connection not found')
        }

        const syncResult = await syncCapabilities(
          connector.id,
          session.user.id,
          workspaceId,
        )

        if (connector.oauth) {
          await db
            .update(schema.account)
            .set({
              status: syncResult.isOk() ? 'connected' : 'degraded',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.account.userId, session.user.id),
                eq(schema.account.workspaceId, workspaceId),
                eq(schema.account.providerId, connector.oauth.providerId),
              ),
            )
        }

        if (syncResult.isErr()) {
          return Response.json(
            { error: syncResult.error.message },
            { status: syncErrorStatus(syncResult.error.code) },
          )
        }

        return Response.json({ ok: true })
      },
    },
  },
})
