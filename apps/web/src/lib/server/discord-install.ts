import { Effect, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import {
  buildDiscordInstallUrl,
  createDiscordSetupState,
  exchangeDiscordInstallCode,
  requireDiscordInstallConfig,
  type DiscordInstallConfig,
} from '@garden/connectors/discord/install'
import { DiscordRestClient } from '@garden/connectors/discord/rest-client'
import { schema, type Db } from './db'
import type { AppEnv } from './env'

export class DiscordInstallDatabaseError extends Schema.Error<DiscordInstallDatabaseError>(
  'DiscordInstallDatabaseError',
)({
  kind: Schema.Literal('database'),
  operation: Schema.String,
  message: Schema.String,
}) {}

/** Uses the configured local origin in development and the request origin elsewhere. */
export const discordRedirectOrigin = (input: {
  readonly env: Pick<AppEnv, 'BETTER_AUTH_URL' | 'ENVIRONMENT'>
  readonly request: Request
}): string => {
  if (input.env.ENVIRONMENT === 'development' && input.env.BETTER_AUTH_URL) {
    return input.env.BETTER_AUTH_URL
  }
  return new URL(input.request.url).origin
}

/** Derives the one fixed callback URL registered for Garden's Discord application. */
export const discordSetupRedirectUri = (input: {
  readonly env: Pick<AppEnv, 'BETTER_AUTH_URL' | 'ENVIRONMENT'>
  readonly request: Request
}): string =>
  new URL('/api/discord/setup', discordRedirectOrigin(input)).toString()

/** Reads and validates Garden-owned Discord application credentials. */
export const discordInstallConfig = Effect.fn('GardenDiscordInstall.config')(
  function* (input: { readonly env: AppEnv; readonly request: Request }) {
    return yield* requireDiscordInstallConfig({
      clientId: input.env.DISCORD_CLIENT_ID,
      clientSecret: input.env.DISCORD_CLIENT_SECRET,
      botToken: input.env.DISCORD_BOT_TOKEN,
      permissions: input.env.DISCORD_BOT_PERMISSIONS,
      redirectUri: discordSetupRedirectUri(input),
    })
  },
)

/** Builds a signed workspace-bound authorization URL for Garden's Discord bot. */
export const buildDiscordInstallRedirect = Effect.fn(
  'GardenDiscordInstall.redirect',
)(function* (input: {
  readonly env: AppEnv
  readonly request: Request
  readonly userId: string
  readonly workspaceId: string
}) {
  const config = yield* discordInstallConfig(input)
  const state = yield* createDiscordSetupState({
    secret: input.env.BETTER_AUTH_SECRET,
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
  return buildDiscordInstallUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    permissions: config.permissions,
    state,
  })
})

/** Loads the workspace's Discord bot installation, including disconnected state. */
export const getDiscordInstallation = Effect.fn('GardenDiscordInstall.get')(
  function* (db: Db, workspaceId: string) {
    return yield* Effect.tryPromise({
      try: async () => {
        const [installation] = await db
          .select()
          .from(schema.discordBotInstallation)
          .where(eq(schema.discordBotInstallation.workspaceId, workspaceId))
          .limit(1)
        return installation ?? null
      },
      catch: () =>
        new DiscordInstallDatabaseError({
          kind: 'database',
          operation: 'get',
          message: 'Discord installation state could not be loaded.',
        }),
    })
  },
)

const requireGuildId = (input: {
  readonly tokenGuildId?: string
  readonly queryGuildId?: string
}) => {
  const guildId = input.tokenGuildId?.trim() || input.queryGuildId?.trim()
  if (guildId) return Effect.succeed(guildId)
  return Effect.fail(
    new DiscordInstallDatabaseError({
      kind: 'database',
      operation: 'resolve_guild',
      message: 'Discord did not return the installed server.',
    }),
  )
}

const scopeList = (scope: string): readonly string[] =>
  scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

const saveDiscordInstallation = Effect.fn('GardenDiscordInstall.save')(
  function* (input: {
    readonly db: Db
    readonly userId: string
    readonly workspaceId: string
    readonly guildId: string
    readonly guildName: string
    readonly guildIcon?: string | null
    readonly permissions?: string | null
    readonly scopes: readonly string[]
  }) {
    yield* Effect.tryPromise({
      try: () => {
        const now = new Date()
        return input.db
          .insert(schema.discordBotInstallation)
          .values({
            workspaceId: input.workspaceId,
            guildId: input.guildId,
            guildName: input.guildName,
            guildIcon: input.guildIcon ?? null,
            permissions: input.permissions ?? null,
            scopes: [...input.scopes],
            status: 'connected',
            connectedBy: input.userId,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: schema.discordBotInstallation.workspaceId,
            set: {
              guildId: input.guildId,
              guildName: input.guildName,
              guildIcon: input.guildIcon ?? null,
              permissions: input.permissions ?? null,
              scopes: [...input.scopes],
              status: 'connected',
              connectedBy: input.userId,
              updatedAt: now,
            },
          })
      },
      catch: () =>
        new DiscordInstallDatabaseError({
          kind: 'database',
          operation: 'save',
          message: 'Discord installation state could not be saved.',
        }),
    })
  },
)

/** Exchanges the callback code, verifies bot access, and saves the guild installation. */
export const completeDiscordBotInstallation = Effect.fn(
  'GardenDiscordInstall.complete',
)(function* (input: {
  readonly db: Db
  readonly config: DiscordInstallConfig
  readonly userId: string
  readonly workspaceId: string
  readonly code: string
  readonly guildId?: string
  readonly permissions?: string
}) {
  const token = yield* exchangeDiscordInstallCode(input.config, input.code)
  const guildId = yield* requireGuildId({
    tokenGuildId: token.guild?.id,
    queryGuildId: input.guildId,
  })
  const restClient = yield* DiscordRestClient
  const guild = yield* restClient.getServer(guildId)
  yield* saveDiscordInstallation({
    db: input.db,
    userId: input.userId,
    workspaceId: input.workspaceId,
    guildId: guild.id,
    guildName: guild.name,
    guildIcon: guild.icon,
    permissions: input.permissions,
    scopes: scopeList(token.scope),
  })
  return { guildId: guild.id, guildName: guild.name }
})

/** Updates connection health after sync or explicit disconnect. */
export const setDiscordInstallStatus = Effect.fn(
  'GardenDiscordInstall.setStatus',
)(function* (
  db: Db,
  workspaceId: string,
  status: 'connected' | 'degraded' | 'disconnected',
) {
  yield* Effect.tryPromise({
    try: () =>
      db
        .update(schema.discordBotInstallation)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.discordBotInstallation.workspaceId, workspaceId)),
    catch: () =>
      new DiscordInstallDatabaseError({
        kind: 'database',
        operation: 'set_status',
        message: 'Discord installation status could not be updated.',
      }),
  })
})

/** Removes the workspace installation while leaving Garden's shared bot credentials intact. */
export const deleteDiscordInstallation = Effect.fn(
  'GardenDiscordInstall.delete',
)(function* (db: Db, workspaceId: string) {
  yield* Effect.tryPromise({
    try: () =>
      db
        .delete(schema.discordBotInstallation)
        .where(eq(schema.discordBotInstallation.workspaceId, workspaceId)),
    catch: () =>
      new DiscordInstallDatabaseError({
        kind: 'database',
        operation: 'delete',
        message: 'Discord installation could not be removed.',
      }),
  })
})
