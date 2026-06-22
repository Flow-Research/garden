import { Effect } from 'effect'
import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { getConnectorById } from '@garden/connectors'
import { isMcpConnector } from '@garden/connectors/sdk'
import {
  connectionActionBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/connections'
import { syncCapabilities } from '@/lib/server/capability-sync'
import {
  badRequest,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'
import { markDiscordInstallStatus } from '@/lib/server/discord-install'

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
  const bodyResult = await parseJsonBody(
    request,
    connectionActionBodySchema,
    'Invalid connection action',
  )

  return bodyResult.isOk()
    ? Result.ok(bodyResult.value.action)
    : Result.err('invalid-action')
}

export const Route = createFileRoute('/api/connections/$connectorId')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
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

        const db = await appContext.db()

        if (actionResult.value === 'disconnect') {
          if (connector.id === 'discord') {
            const result = await Effect.runPromise(
              markDiscordInstallStatus({
                db,
                workspaceId,
                status: 'disconnected',
              }).pipe(
                Effect.match({
                  onFailure: (error) => ({ ok: false as const, error }),
                  onSuccess: (updated) => ({ ok: true as const, updated }),
                }),
              ),
            )

            if (!result.ok) {
              return Response.json(
                { error: result.error.message },
                { status: 500 },
              )
            }

            return result.updated
              ? Response.json({ ok: true })
              : notFound('Connection not found')
          }

          if (!isMcpConnector(connector) || !connector.oauth) {
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

        if (connector.id === 'discord') {
          const result = await Effect.runPromise(
            markDiscordInstallStatus({
              db,
              workspaceId,
              status: syncResult.isOk() ? 'connected' : 'degraded',
            }).pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false as const, error }),
                onSuccess: (updated) => ({ ok: true as const, updated }),
              }),
            ),
          )

          if (!result.ok) {
            return Response.json({ error: result.error.message }, { status: 500 })
          }
          if (!result.updated) return notFound('Connection not found')
        }

        if (isMcpConnector(connector) && connector.oauth) {
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
