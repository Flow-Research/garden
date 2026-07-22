import { Effect, Layer, Option, Result, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest, unauthorized } from '@/lib/server/control-plane'
import { syncCapabilities } from '@/lib/server/capability-sync'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  completeDiscordBotInstallation,
  discordInstallConfig,
  discordRedirectOrigin,
  setDiscordInstallStatus,
} from '@/lib/server/discord-install'
import { resolveDiscordSetupState } from '@garden/connectors/discord/install'
import {
  makeDiscordBaseLayer,
  makeDiscordHttpClientLayer,
} from '@garden/connectors/discord/services'

const DiscordCallbackQuery = Schema.Struct({
  code: Schema.OptionFromNullishOr(Schema.String),
  state: Schema.OptionFromNullishOr(Schema.String),
  guildId: Schema.OptionFromNullishOr(Schema.String),
  permissions: Schema.OptionFromNullishOr(Schema.String),
  error: Schema.OptionFromNullishOr(Schema.String),
})

const decodeCallbackQuery = Effect.fn('DiscordSetup.decodeQuery')(function* (
  request: Request,
) {
  const params = new URL(request.url).searchParams
  return yield* Schema.decodeUnknownEffect(DiscordCallbackQuery)({
    code: params.get('code'),
    state: params.get('state'),
    guildId: params.get('guild_id'),
    permissions: params.get('permissions'),
    error: params.get('error'),
  })
})

const workspaceRedirect = (
  request: Request,
  status: 'connected' | 'degraded' | 'error',
): Response => {
  const url = new URL(
    '/workspace',
    discordRedirectOrigin({ env: appEnv, request }),
  )
  url.searchParams.set('connection', 'discord')
  url.searchParams.set('status', status)
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

/** Completes Discord bot authorization using signed state rather than browser session cookies. */
export const Route = createFileRoute('/api/discord/setup')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const queryResult = await Effect.runPromise(
          Effect.result(decodeCallbackQuery(request)),
        )
        if (Result.isFailure(queryResult)) {
          return badRequest('Discord callback query is invalid')
        }
        const query = queryResult.success
        if (Option.isNone(query.state)) {
          return badRequest('Discord callback is missing state')
        }

        const stateResult = await Effect.runPromise(
          Effect.result(
            resolveDiscordSetupState({
              secret: appEnv.BETTER_AUTH_SECRET,
              state: query.state.value,
            }),
          ),
        )
        if (Result.isFailure(stateResult)) {
          return badRequest(stateResult.failure.message)
        }
        const state = stateResult.success
        const db = await appContext.db()
        const [membership] = await db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, state.workspaceId),
              eq(schema.member.userId, state.userId),
            ),
          )
          .limit(1)
        if (!membership) return unauthorized()
        if (Option.isSome(query.error)) {
          return workspaceRedirect(request, 'error')
        }
        if (Option.isNone(query.code)) {
          return badRequest('Discord callback is missing code')
        }

        const configResult = await Effect.runPromise(
          Effect.result(discordInstallConfig({ env: appEnv, request })),
        )
        if (Result.isFailure(configResult)) {
          return Response.json(
            { error: configResult.failure.message },
            { status: 500 },
          )
        }
        const config = configResult.success
        const layer = Layer.mergeAll(
          makeDiscordHttpClientLayer(),
          makeDiscordBaseLayer({ botToken: config.botToken }),
        )
        const installResult = await Effect.runPromise(
          Effect.result(
            Effect.provide(
              completeDiscordBotInstallation({
                db,
                config,
                userId: state.userId,
                workspaceId: state.workspaceId,
                code: query.code.value,
                guildId: Option.getOrUndefined(query.guildId),
                permissions: Option.getOrUndefined(query.permissions),
              }),
              layer,
            ),
          ),
        )
        if (Result.isFailure(installResult)) {
          return workspaceRedirect(request, 'error')
        }

        const syncResult = await Effect.runPromise(
          Effect.result(
            syncCapabilities('discord', state.userId, state.workspaceId),
          ),
        )
        if (Result.isFailure(syncResult)) {
          await Effect.runPromise(
            setDiscordInstallStatus(db, state.workspaceId, 'degraded'),
          )
          return workspaceRedirect(request, 'degraded')
        }
        return workspaceRedirect(request, 'connected')
      },
    },
  },
})
