import { Effect } from 'effect'
import { HttpClient } from 'effect/unstable/http'
import { and, eq } from 'drizzle-orm'
import type { ConnectorCallbackStatus } from './connector-callback-events'
import { schema, type Db } from './db'
import type { AppEnv } from './env'
import {
  ConnectorDatabaseError,
  ConnectorDecodeError,
  type ConnectorError,
} from '@garden/connectors/effect/errors'
import {
  buildDiscordInstallUrl,
  createDiscordSetupState,
  exchangeDiscordInstallCode,
  requireDiscordInstallConfig,
  type DiscordInstallConfig,
} from '@garden/connectors/discord/install'
import { DiscordRestClient } from '@garden/connectors/discord/rest-client'

export type DiscordInstallDb = Db

export type DiscordInstallOutcome = {
  status: ConnectorCallbackStatus
  stage: string
  message: string
  errorCode?: string | null
  accountLogin?: string | null
}

export function isDevelopmentEnv(env: Pick<AppEnv, 'ENVIRONMENT'>) {
  return env.ENVIRONMENT === 'development'
}

export function discordRedirectOrigin(args: {
  env: Pick<AppEnv, 'BETTER_AUTH_URL' | 'ENVIRONMENT'>
  request: Request
}) {
  return isDevelopmentEnv(args.env) && args.env.BETTER_AUTH_URL
    ? args.env.BETTER_AUTH_URL
    : new URL(args.request.url).origin
}

export function discordSetupRedirectUri(args: {
  env: Pick<AppEnv, 'BETTER_AUTH_URL' | 'DISCORD_REDIRECT_URI' | 'ENVIRONMENT'>
  request: Request
}) {
  return (
    args.env.DISCORD_REDIRECT_URI?.trim() ||
    new URL('/api/discord/setup', discordRedirectOrigin(args)).toString()
  )
}

export function discordInstallConfig(args: { env: AppEnv; request: Request }) {
  return requireDiscordInstallConfig({
    clientId: args.env.DISCORD_CLIENT_ID,
    clientSecret: args.env.DISCORD_CLIENT_SECRET,
    botToken: args.env.DISCORD_BOT_TOKEN,
    permissions: args.env.DISCORD_BOT_PERMISSIONS,
    redirectUri: discordSetupRedirectUri({ env: args.env, request: args.request }),
  })
}

/**
 * Builds the Discord shared-bot authorization URL with signed Garden state.
 * Discord's regular bot flow has no callback; Garden uses the advanced code
 * flow so workspace install state is durable and testable end-to-end.
 */
export function buildDiscordInstallRedirect(args: {
  env: AppEnv
  request: Request
  userId: string
  workspaceId: string
  flowId?: string | null
}) {
  return Effect.gen(function* () {
    const config = yield* discordInstallConfig({
      env: args.env,
      request: args.request,
    })
    const state = yield* createDiscordSetupState({
      secret: args.env.BETTER_AUTH_SECRET,
      userId: args.userId,
      workspaceId: args.workspaceId,
      flowId: args.flowId,
    })

    return buildDiscordInstallUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      permissions: config.permissions,
      state,
    })
  })
}

export function hasConnectedDiscordInstall(args: {
  db: DiscordInstallDb
  workspaceId: string
}) {
  return Effect.tryPromise({
    try: async () => {
      const [installation] = await args.db
        .select({ id: schema.discordBotInstallation.id })
        .from(schema.discordBotInstallation)
        .where(
          and(
            eq(schema.discordBotInstallation.workspaceId, args.workspaceId),
            eq(schema.discordBotInstallation.status, 'connected'),
          ),
        )
        .limit(1)

      return installation ? true : false
    },
    catch: (cause) =>
      new ConnectorDatabaseError({
        connectorId: 'discord',
        operation: 'install.check_connected',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to check Discord bot installation',
        cause,
      }),
  })
}

function guildIdFromCallback(args: {
  tokenGuildId?: string | undefined
  queryGuildId?: string | null | undefined
}) {
  const guildId = args.tokenGuildId?.trim() || args.queryGuildId?.trim()
  return guildId
    ? Effect.succeed(guildId)
    : Effect.fail(
        new ConnectorDecodeError({
          connectorId: 'discord',
          operation: 'install.resolve_guild',
          message: 'Discord install callback did not include a guild id',
        }),
      )
}

function saveDiscordInstallation(args: {
  db: DiscordInstallDb
  userId: string
  workspaceId: string
  guildId: string
  guildName: string
  guildIcon?: string | null | undefined
  permissions?: string | null | undefined
  scopes: readonly string[]
}) {
  return Effect.tryPromise({
    try: async () => {
      const now = new Date()
      const installationRecord = {
        workspaceId: args.workspaceId,
        guildId: args.guildId,
        guildName: args.guildName,
        guildIcon: args.guildIcon ?? null,
        permissions: args.permissions ?? null,
        scopes: [...args.scopes],
        status: 'connected',
        connectedBy: args.userId,
        updatedAt: now,
      }

      const [existingInstallation] = await args.db
        .select({ id: schema.discordBotInstallation.id })
        .from(schema.discordBotInstallation)
        .where(eq(schema.discordBotInstallation.workspaceId, args.workspaceId))
        .limit(1)

      if (existingInstallation) {
        await args.db
          .update(schema.discordBotInstallation)
          .set(installationRecord)
          .where(eq(schema.discordBotInstallation.id, existingInstallation.id))
      } else {
        await args.db.insert(schema.discordBotInstallation).values(installationRecord)
      }
    },
    catch: (cause) =>
      new ConnectorDatabaseError({
        connectorId: 'discord',
        operation: 'install.save',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to save Discord bot installation',
        cause,
      }),
  })
}

function scopeList(scope: string) {
  return scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

/**
 * Completes Discord bot install by exchanging the code, verifying the bot can
 * see the installed guild, then atomically upserting workspace install state.
 */
export function completeDiscordBotInstallation(args: {
  db: DiscordInstallDb
  config: DiscordInstallConfig
  userId: string
  workspaceId: string
  code: string
  guildId?: string | null
  permissions?: string | null
}): Effect.Effect<
  { guildId: string; guildName: string },
  ConnectorError,
  DiscordRestClient | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient
    const token = yield* exchangeDiscordInstallCode({
      client: httpClient,
      config: args.config,
      code: args.code,
    })
    const guildId = yield* guildIdFromCallback({
      tokenGuildId: token.guild?.id,
      queryGuildId: args.guildId,
    })
    const restClient = yield* DiscordRestClient
    const guild = yield* restClient.getServer(guildId)

    yield* saveDiscordInstallation({
      db: args.db,
      userId: args.userId,
      workspaceId: args.workspaceId,
      guildId: guild.id,
      guildName: guild.name,
      guildIcon: guild.icon,
      permissions: args.permissions,
      scopes: scopeList(token.scope),
    })

    return { guildId: guild.id, guildName: guild.name }
  })
}

export function markDiscordInstallStatus(args: {
  db: DiscordInstallDb
  workspaceId: string
  status: 'connected' | 'degraded' | 'disconnected'
}) {
  return Effect.tryPromise({
    try: async () => {
      const [installation] = await args.db
        .update(schema.discordBotInstallation)
        .set({ status: args.status, updatedAt: new Date() })
        .where(eq(schema.discordBotInstallation.workspaceId, args.workspaceId))
        .returning({ id: schema.discordBotInstallation.id })

      return installation ? true : false
    },
    catch: (cause) =>
      new ConnectorDatabaseError({
        connectorId: 'discord',
        operation: 'install.mark_status',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to update Discord bot installation status',
        cause,
      }),
  })
}

export function discordInstallErrorToOutcome(
  error: ConnectorError,
): DiscordInstallOutcome {
  return {
    status: 'error',
    stage: error._tag,
    message: error.message,
    errorCode: error._tag,
  }
}
