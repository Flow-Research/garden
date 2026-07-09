import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { revokeOAuthConnector } from '@/lib/server/connector-revocation'
import { appEnv } from '@/lib/server/env'
import { getConnectorById } from '@garden/connectors'
import { deleteGitHubAppInstallation } from '@garden/connectors/github-app'
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
import { schema, type Db } from '@/lib/server/db'

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

/**
 * Updates the GitHub App install row rather than the OAuth account table.
 * GitHub uses the connector.oauth metadata only for upstream host/scopes, while
 * the actual install state lives in github_app_installation. Previously resync
 * and disconnect wrote account rows that do not exist for GitHub App installs,
 * so degraded installs could not recover or disappear cleanly. After this, the
 * API boundary keeps GitHub App status in its canonical table. References
 * consulted: local GitHub App schema/callback flow and better-result boundary
 * handling guidance.
 */
async function updateGitHubInstallationStatus(args: {
  db: Db
  workspaceId: string
  status: 'connected' | 'degraded' | 'disconnected'
}) {
  const [installation] = await args.db
    .update(schema.githubAppInstallation)
    .set({ status: args.status, updatedAt: new Date() })
    .where(eq(schema.githubAppInstallation.workspaceId, args.workspaceId))
    .returning({ id: schema.githubAppInstallation.id })

  return installation
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
          return Response.json(
            { error: 'Workspace not found' },
            { status: 404 },
          )
        }

        const connector = getConnectorById(params.connectorId)
        if (!connector) return notFound('Connector not found')

        const actionResult = await parseAction(request)
        if (actionResult.isErr()) {
          return badRequest('Invalid connection action')
        }

        const db = await appContext.db()

        if (actionResult.value === 'disconnect') {
          if (connector.id === 'github') {
            const [installation] = await db
              .select({
                installationId: schema.githubAppInstallation.installationId,
              })
              .from(schema.githubAppInstallation)
              .where(eq(schema.githubAppInstallation.workspaceId, workspaceId))
              .limit(1)
            if (!installation) return notFound('Connection not found')

            const revokeResult = await deleteGitHubAppInstallation({
              env: {
                GITHUB_APP_ID: appEnv.GITHUB_APP_ID,
                GITHUB_CLIENT_ID: appEnv.GITHUB_CLIENT_ID,
                GITHUB_APP_PRIVATE_KEY: appEnv.GITHUB_APP_PRIVATE_KEY,
              },
              installationId: installation.installationId,
            })
            if (revokeResult.isErr()) {
              return Response.json(
                { error: revokeResult.error.message },
                { status: 502 },
              )
            }

            await updateGitHubInstallationStatus({
              db,
              workspaceId,
              status: 'disconnected',
            })
            return Response.json({ ok: true })
          }

          if (!connector.oauth) {
            return badRequest('Connector does not support disconnect')
          }

          const [account] = await db
            .select({
              id: schema.account.id,
              accessToken: schema.account.accessToken,
              refreshToken: schema.account.refreshToken,
            })
            .from(schema.account)
            .where(
              and(
                eq(schema.account.userId, session.user.id),
                eq(schema.account.workspaceId, workspaceId),
                eq(schema.account.providerId, connector.oauth.providerId),
              ),
            )
            .limit(1)
          if (!account) return notFound('Connection not found')

          const revokeResult = await revokeOAuthConnector({
            connectorId: connector.id,
            accessToken: account.accessToken,
            refreshToken: account.refreshToken,
          })
          if (revokeResult.isErr()) {
            return Response.json(
              { error: revokeResult.error.message },
              { status: 502 },
            )
          }

          await db
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
            .where(eq(schema.account.id, account.id))

          return Response.json({ ok: true })
        }

        const syncResult = await syncCapabilities(
          connector.id,
          session.user.id,
          workspaceId,
        )

        if (connector.id === 'github') {
          await updateGitHubInstallationStatus({
            db,
            workspaceId,
            status: syncResult.isOk() ? 'connected' : 'degraded',
          })
        } else if (connector.oauth) {
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
