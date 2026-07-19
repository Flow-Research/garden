import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  decryptStoredOAuthTokens,
  revokeOAuthConnector,
} from '@/lib/server/connector-revocation'
import { appEnv } from '@/lib/server/env'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { getConnectorById } from '@garden/connectors'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
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
import {
  capturePostHogEvent,
  capturePostHogHandledError,
} from '@/lib/posthog-server'

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

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId,
          permissions: workspacePermissions.connectionManage,
        })
        if (permission) return permission

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
                updatedAt: schema.githubAppInstallation.updatedAt,
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
              capturePostHogHandledError(appContext, {
                distinctId: session.user.id,
                workspaceId,
                error: revokeResult.error,
                properties: {
                  operation: 'connector_disconnect',
                  connector_id: connector.id,
                  stage: 'provider_revoke',
                },
              })
              return Response.json(
                { error: revokeResult.error.message },
                { status: 502 },
              )
            }

            const [disconnectedInstallation] = await db
              .update(schema.githubAppInstallation)
              .set({ status: 'disconnected', updatedAt: new Date() })
              .where(
                and(
                  eq(schema.githubAppInstallation.workspaceId, workspaceId),
                  eq(
                    schema.githubAppInstallation.installationId,
                    installation.installationId,
                  ),
                  eq(
                    schema.githubAppInstallation.updatedAt,
                    installation.updatedAt,
                  ),
                ),
              )
              .returning({ id: schema.githubAppInstallation.id })
            if (!disconnectedInstallation) {
              return Response.json(
                { error: 'Connection changed while disconnecting' },
                { status: 409 },
              )
            }

            capturePostHogEvent(appContext, {
              distinctId: session.user.id,
              event: GARDEN_ANALYTICS_EVENTS.connectorDisconnected,
              workspaceId,
              properties: {
                connector_id: connector.id,
                connection_id: disconnectedInstallation.id,
                connection_kind: 'github_app',
              },
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
              updatedAt: schema.account.updatedAt,
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

          const tokenResult = await Result.tryPromise({
            try: async () => {
              const auth = await appContext.auth.getAuth()
              return await decryptStoredOAuthTokens({
                accessToken: account.accessToken,
                refreshToken: account.refreshToken,
                context: await auth.$context,
              })
            },
            catch: () => 'Failed to decrypt connector credentials',
          })
          if (tokenResult.isErr()) {
            capturePostHogHandledError(appContext, {
              distinctId: session.user.id,
              workspaceId,
              error: new Error(tokenResult.error),
              properties: {
                operation: 'connector_disconnect',
                connector_id: connector.id,
                stage: 'credential_decrypt',
              },
            })
            return Response.json({ error: tokenResult.error }, { status: 500 })
          }

          const revokeResult = await revokeOAuthConnector({
            connectorId: connector.id,
            accessToken: tokenResult.value.accessToken,
            refreshToken: tokenResult.value.refreshToken,
          })
          if (revokeResult.isErr()) {
            capturePostHogHandledError(appContext, {
              distinctId: session.user.id,
              workspaceId,
              error: revokeResult.error,
              properties: {
                operation: 'connector_disconnect',
                connector_id: connector.id,
                stage: 'provider_revoke',
              },
            })
            return Response.json(
              { error: revokeResult.error.message },
              { status: 502 },
            )
          }

          const [disconnectedAccount] = await db
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
                eq(schema.account.id, account.id),
                eq(schema.account.updatedAt, account.updatedAt),
              ),
            )
            .returning({ id: schema.account.id })

          if (!disconnectedAccount) {
            return Response.json(
              { error: 'Connection changed while disconnecting' },
              { status: 409 },
            )
          }

          capturePostHogEvent(appContext, {
            distinctId: session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.connectorDisconnected,
            workspaceId,
            properties: {
              connector_id: connector.id,
              connection_id: disconnectedAccount.id,
              connection_kind: 'oauth',
            },
          })
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
          capturePostHogHandledError(appContext, {
            distinctId: session.user.id,
            workspaceId,
            error: syncResult.error,
            properties: {
              operation: 'connector_resync',
              connector_id: connector.id,
              stage: 'capability_sync',
            },
          })
          capturePostHogEvent(appContext, {
            distinctId: session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.connectorResyncCompleted,
            workspaceId,
            properties: {
              connector_id: connector.id,
              outcome: 'degraded',
              error_code: syncResult.error.code,
            },
          })
          return Response.json(
            { error: syncResult.error.message },
            { status: syncErrorStatus(syncResult.error.code) },
          )
        }

        capturePostHogEvent(appContext, {
          distinctId: session.user.id,
          event: GARDEN_ANALYTICS_EVENTS.connectorResyncCompleted,
          workspaceId,
          properties: {
            connector_id: connector.id,
            outcome: 'connected',
          },
        })
        return Response.json({ ok: true })
      },
    },
  },
})
