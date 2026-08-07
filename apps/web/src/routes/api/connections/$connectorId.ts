import { Effect, Result } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import {
  deleteGitHubAppInstallation,
  getGitHubAppInstallation,
} from '@garden/connectors/github-app'
import { eq } from 'drizzle-orm'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
} from '@executor-js/sdk/core'
import { requireAppRequestContext } from '@/lib/server/context'
import { capturePostHogEvent } from '@/lib/posthog-server'
import { syncCapabilities } from '@/lib/server/capability-sync'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { captureApiFailure, logApiFailure } from '@/lib/server/api-logging'
import {
  deleteDiscordInstallation,
  getDiscordInstallation,
  setDiscordInstallStatus,
} from '@/lib/server/discord-install'
import {
  requireWorkspaceContext,
  badRequest,
  notFound,
} from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  connectionActionBodySchema,
  connectionCredentialBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/connections'
import {
  ConnectionOwnership,
  connectionOwnershipLayer,
} from '@/lib/server/executor-engine/connection-ownership'
import { runExecutor, type GardenExecutor } from '@/lib/server/executor-runtime'

interface CredentialConnectionInput {
  readonly connectorId: string
  readonly name: string
  readonly template: string
  readonly values: Record<string, string>
}

/**
 * Creates and validates a credential-backed Executor connection using the
 * request-provided ownership service. HTTP decoding and Workspace authorization
 * happen before this program is provided its owner layer.
 */
const createCredentialConnection = Effect.fn(
  'ExecutorConnection.createCredential',
)(function* (executor: GardenExecutor, input: CredentialConnectionInput) {
  const ownership = yield* ConnectionOwnership
  const integration = yield* executor.integrations.get(
    IntegrationSlug.make(input.connectorId),
  )
  if (!integration) return { kind: 'not-found' as const }

  const method = integration.authMethods.find(
    (candidate) => candidate.template === input.template,
  )
  if (!method || (method.kind !== 'apikey' && method.kind !== 'header')) {
    return { kind: 'invalid-template' as const }
  }

  const expectedVariables = new Set(
    (method.placements ?? []).flatMap((placement) =>
      placement.literal === undefined ? [placement.variable ?? 'token'] : [],
    ),
  )
  const suppliedVariables = Object.keys(input.values)
  if (
    suppliedVariables.length !== expectedVariables.size ||
    suppliedVariables.some((variable) => !expectedVariables.has(variable))
  ) {
    return { kind: 'invalid-values' as const }
  }

  const connection = yield* executor.connections.create({
    owner: ownership.owner,
    name: ConnectionName.make(input.name),
    integration: integration.slug,
    template: AuthTemplateSlug.make(method.template),
    values: input.values,
  })
  const refreshResult = yield* executor.connections
    .refresh(connection)
    .pipe(Effect.result)
  if (Result.isFailure(refreshResult)) {
    yield* executor.connections.remove(connection)
    return {
      kind: 'credential-failed' as const,
      error: refreshResult.failure,
    }
  }
  return {
    kind: 'created' as const,
    connection: String(connection.address),
    toolCount: refreshResult.success.length,
  }
})

export const Route = createFileRoute('/api/connections/$connectorId')({
  server: {
    handlers: {
      PUT: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const bodyResult = await parseJsonBody(
          request,
          connectionCredentialBodySchema,
          'Invalid connection credentials',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        if (bodyResult.value.owner === 'org') {
          const permission = await requireWorkspacePermission({
            appContext,
            request,
            workspaceId: workspaceContext.workspaceId,
            permissions: workspacePermissions.connectionManage,
          })
          if (permission) return permission
        }

        const ownershipLayer = connectionOwnershipLayer(bodyResult.value.owner)
        const outcome = await runExecutor(
          {
            tenant: workspaceContext.workspaceId,
            subject: workspaceContext.session.user.id,
          },
          (executor) =>
            createCredentialConnection(executor, {
              connectorId: params.connectorId,
              name: bodyResult.value.name,
              template: bodyResult.value.template,
              values: bodyResult.value.values,
            }).pipe(Effect.provide(ownershipLayer)),
        )

        if (outcome.kind === 'not-found') {
          return notFound('Integration not found')
        }
        if (outcome.kind === 'invalid-template') {
          return badRequest(
            'This integration does not expose that credential method',
          )
        }
        if (outcome.kind === 'invalid-values') {
          return badRequest(
            'Credential fields do not match the selected method',
          )
        }
        if (outcome.kind === 'credential-failed') {
          logApiFailure({
            request,
            event: 'executor.connection.credential_validation_failed',
            error: outcome.error,
            level: 'warn',
          })
          capturePostHogEvent(appContext, {
            distinctId: workspaceContext.session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.connectorConnectionFailed,
            workspaceId: workspaceContext.workspaceId,
            properties: {
              connector_id: params.connectorId,
              connection_kind: 'credential',
              stage: 'credential_refresh',
            },
          })
          return badRequest(
            'The provider rejected these credentials or tool sync failed',
          )
        }
        capturePostHogEvent(appContext, {
          distinctId: workspaceContext.session.user.id,
          event: GARDEN_ANALYTICS_EVENTS.connectorConnectionCompleted,
          workspaceId: workspaceContext.workspaceId,
          properties: {
            connector_id: params.connectorId,
            connection_kind: 'credential',
            tool_count: outcome.toolCount,
          },
        })
        return Response.json({
          ok: true,
          connection: outcome.connection,
          toolCount: outcome.toolCount,
        })
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId: workspaceContext.workspaceId,
          permissions: workspacePermissions.connectionManage,
        })
        if (permission) return permission

        const bodyResult = await parseJsonBody(
          request,
          connectionActionBodySchema,
          'Invalid connection action',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        if (params.connectorId === 'github') {
          if (bodyResult.value.action === 'connect') {
            return badRequest('Use Add to GitHub to connect this integration')
          }
          const db = await appContext.db()
          const [installation] = await db
            .select()
            .from(schema.githubAppInstallation)
            .where(
              eq(
                schema.githubAppInstallation.workspaceId,
                workspaceContext.workspaceId,
              ),
            )
            .limit(1)
          if (installation === undefined) {
            return notFound('GitHub App installation not found')
          }

          if (
            bodyResult.value.action === 'delete' ||
            bodyResult.value.action === 'disconnect'
          ) {
            const uninstalled = await deleteGitHubAppInstallation({
              env: {
                GITHUB_APP_ID: appEnv.GITHUB_APP_ID,
                GITHUB_CLIENT_ID: appEnv.GITHUB_CLIENT_ID,
                GITHUB_APP_PRIVATE_KEY: appEnv.GITHUB_APP_PRIVATE_KEY,
              },
              installationId: installation.installationId,
            })
            if (uninstalled.isErr()) {
              await captureApiFailure({
                request,
                event: 'github.installation.delete_failed',
                error: uninstalled.error,
              })
              return Response.json(
                { error: uninstalled.error.message },
                { status: 502 },
              )
            }
            await db
              .delete(schema.githubAppInstallation)
              .where(
                eq(
                  schema.githubAppInstallation.workspaceId,
                  workspaceContext.workspaceId,
                ),
              )
            capturePostHogEvent(appContext, {
              distinctId: workspaceContext.session.user.id,
              event: GARDEN_ANALYTICS_EVENTS.connectorDisconnected,
              workspaceId: workspaceContext.workspaceId,
              properties: {
                connector_id: 'github',
                connection_kind: 'github_app',
              },
            })
            return Response.json({ ok: true })
          }

          const verified = await getGitHubAppInstallation({
            env: {
              GITHUB_APP_ID: appEnv.GITHUB_APP_ID,
              GITHUB_CLIENT_ID: appEnv.GITHUB_CLIENT_ID,
              GITHUB_APP_PRIVATE_KEY: appEnv.GITHUB_APP_PRIVATE_KEY,
            },
            installationId: installation.installationId,
          })
          let status = 'connected'
          let error: string | undefined
          if (verified.isErr()) {
            status = 'degraded'
            error = verified.error.message
            await captureApiFailure({
              request,
              event: 'github.installation.verify_failed',
              error: verified.error,
              level: 'warn',
            })
          } else {
            const synced = await Effect.runPromise(
              Effect.result(
                syncCapabilities(
                  'github',
                  workspaceContext.session.user.id,
                  workspaceContext.workspaceId,
                ),
              ),
            )
            if (Result.isFailure(synced)) {
              status = 'degraded'
              error = synced.failure.message
              await captureApiFailure({
                request,
                event: 'github.installation.capability_sync_failed',
                error: synced.failure,
                level: 'warn',
              })
            }
          }
          await db
            .update(schema.githubAppInstallation)
            .set({ status, updatedAt: new Date() })
            .where(
              eq(
                schema.githubAppInstallation.workspaceId,
                workspaceContext.workspaceId,
              ),
            )
          capturePostHogEvent(appContext, {
            distinctId: workspaceContext.session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.connectorResyncCompleted,
            workspaceId: workspaceContext.workspaceId,
            properties: {
              connector_id: 'github',
              outcome: error === undefined ? 'connected' : 'degraded',
            },
          })
          if (error !== undefined) {
            return Response.json({ error }, { status: 502 })
          }
          return Response.json({ ok: true })
        }

        if (params.connectorId === 'discord') {
          const db = await appContext.db()
          if (bodyResult.value.action === 'connect') {
            return badRequest('Use Add to Discord to connect this integration')
          }
          if (bodyResult.value.action === 'delete') {
            const deleted = await Effect.runPromise(
              Effect.result(
                deleteDiscordInstallation(db, workspaceContext.workspaceId),
              ),
            )
            if (Result.isFailure(deleted)) {
              await captureApiFailure({
                request,
                event: 'discord.installation.delete_failed',
                error: deleted.failure,
              })
              return Response.json(
                { error: deleted.failure.message },
                { status: 500 },
              )
            }
            capturePostHogEvent(appContext, {
              distinctId: workspaceContext.session.user.id,
              event: GARDEN_ANALYTICS_EVENTS.connectorDisconnected,
              workspaceId: workspaceContext.workspaceId,
              properties: {
                connector_id: 'discord',
                connection_kind: 'discord_bot',
                action: 'delete',
              },
            })
            return Response.json({ ok: true })
          }
          if (bodyResult.value.action === 'disconnect') {
            const disconnected = await Effect.runPromise(
              Effect.result(
                setDiscordInstallStatus(
                  db,
                  workspaceContext.workspaceId,
                  'disconnected',
                ),
              ),
            )
            if (Result.isFailure(disconnected)) {
              await captureApiFailure({
                request,
                event: 'discord.installation.disconnect_failed',
                error: disconnected.failure,
              })
              return Response.json(
                { error: disconnected.failure.message },
                { status: 500 },
              )
            }
            capturePostHogEvent(appContext, {
              distinctId: workspaceContext.session.user.id,
              event: GARDEN_ANALYTICS_EVENTS.connectorDisconnected,
              workspaceId: workspaceContext.workspaceId,
              properties: {
                connector_id: 'discord',
                connection_kind: 'discord_bot',
                action: 'disconnect',
              },
            })
            return Response.json({ ok: true })
          }

          const installation = await Effect.runPromise(
            Effect.result(
              getDiscordInstallation(db, workspaceContext.workspaceId),
            ),
          )
          if (Result.isFailure(installation)) {
            await captureApiFailure({
              request,
              event: 'discord.installation.load_failed',
              error: installation.failure,
            })
            return Response.json(
              { error: installation.failure.message },
              { status: 500 },
            )
          }
          if (installation.success === null) {
            return notFound('Discord installation not found')
          }
          const synced = await Effect.runPromise(
            Effect.result(
              syncCapabilities(
                'discord',
                workspaceContext.session.user.id,
                workspaceContext.workspaceId,
              ),
            ),
          )
          const status = Result.isFailure(synced) ? 'degraded' : 'connected'
          const updated = await Effect.runPromise(
            Effect.result(
              setDiscordInstallStatus(db, workspaceContext.workspaceId, status),
            ),
          )
          if (Result.isFailure(updated)) {
            await captureApiFailure({
              request,
              event: 'discord.installation.status_update_failed',
              error: updated.failure,
            })
            return Response.json(
              { error: updated.failure.message },
              { status: 500 },
            )
          }
          capturePostHogEvent(appContext, {
            distinctId: workspaceContext.session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.connectorResyncCompleted,
            workspaceId: workspaceContext.workspaceId,
            properties: {
              connector_id: 'discord',
              outcome: Result.isFailure(synced) ? 'degraded' : 'connected',
            },
          })
          if (Result.isFailure(synced)) {
            await captureApiFailure({
              request,
              event: 'discord.installation.capability_sync_failed',
              error: synced.failure,
              level: 'warn',
            })
            return Response.json(
              { error: 'Discord tool sync failed' },
              { status: 502 },
            )
          }
          return Response.json({ ok: true })
        }

        const outcome = await runExecutor(
          {
            tenant: workspaceContext.workspaceId,
            subject: workspaceContext.session.user.id,
          },
          (executor) =>
            Effect.gen(function* () {
              const integration = yield* executor.integrations.get(
                IntegrationSlug.make(params.connectorId),
              )
              if (!integration) return { kind: 'not-found' as const }
              const connections = (yield* executor.connections.list()).filter(
                (connection) =>
                  String(connection.integration) === params.connectorId,
              )
              if (bodyResult.value.action === 'delete') {
                yield* Effect.all(
                  connections.map((connection) =>
                    executor.connections.remove(connection),
                  ),
                )
                yield* executor.integrations.remove(integration.slug)
                return { kind: 'updated' as const }
              }
              if (bodyResult.value.action === 'connect') {
                if (connections.length > 0) {
                  return { kind: 'connected' as const }
                }
                const noAuthMethod = integration.authMethods.find(
                  (method) => method.kind === 'none',
                )
                if (!noAuthMethod && integration.authMethods.length > 0) {
                  return { kind: 'credentials-required' as const }
                }
                const connection = yield* executor.connections.create({
                  owner: 'org',
                  name: ConnectionName.make('default'),
                  integration: integration.slug,
                  template: AuthTemplateSlug.make(
                    noAuthMethod?.template ?? 'none',
                  ),
                  values: {},
                })
                if (integration.canRefresh) {
                  yield* executor.connections.refresh(connection)
                }
                return { kind: 'connected' as const }
              }
              if (connections.length === 0) {
                return { kind: 'connection-not-found' as const }
              }
              if (bodyResult.value.action === 'disconnect') {
                yield* Effect.all(
                  connections.map((connection) =>
                    executor.connections.remove(connection),
                  ),
                )
              } else {
                yield* Effect.all(
                  connections.map((connection) =>
                    executor.connections.refresh(connection),
                  ),
                )
              }
              return { kind: 'updated' as const }
            }),
        )
        if (outcome.kind === 'not-found') {
          return notFound('Integration not found')
        }
        if (outcome.kind === 'connection-not-found') {
          return notFound('Connection not found')
        }
        if (outcome.kind === 'credentials-required') {
          return badRequest('This integration requires credentials')
        }
        capturePostHogEvent(appContext, {
          distinctId: workspaceContext.session.user.id,
          event:
            bodyResult.value.action === 'resync'
              ? GARDEN_ANALYTICS_EVENTS.connectorResyncCompleted
              : bodyResult.value.action === 'connect'
                ? GARDEN_ANALYTICS_EVENTS.connectorConnected
                : GARDEN_ANALYTICS_EVENTS.connectorDisconnected,
          workspaceId: workspaceContext.workspaceId,
          properties: {
            connector_id: params.connectorId,
            connection_kind: 'executor',
            action: bodyResult.value.action,
            outcome: 'connected',
          },
        })
        return Response.json({ ok: true })
      },
    },
  },
})
