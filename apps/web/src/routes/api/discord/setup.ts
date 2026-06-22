import { Effect, Layer } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import { syncCapabilities } from '@/lib/server/capability-sync'
import { schema, type Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  connectorCallbackSearchParams,
  recordConnectorCallbackEvent,
} from '@/lib/server/connector-callback-events'
import {
  completeDiscordBotInstallation,
  discordInstallConfig,
  discordInstallErrorToOutcome,
  discordRedirectOrigin,
  markDiscordInstallStatus,
  type DiscordInstallOutcome,
} from '@/lib/server/discord-install'
import { resolveDiscordSetupState } from '@garden/connectors/discord/install'
import {
  makeDiscordBaseLayer,
  makeDiscordHttpClientLayer,
} from '@garden/connectors/discord/services'
import {
  ConnectorDatabaseError,
  ConnectorDecodeError,
  type ConnectorError,
} from '@garden/connectors/effect/errors'

type DiscordSetupDb = Db

function redirectToConnections(request: Request, flowId?: string | null) {
  const url = new URL(
    '/workspace',
    discordRedirectOrigin({ env: appEnv, request }),
  )
  url.search = connectorCallbackSearchParams({
    connectorId: 'discord',
    flowId,
  }).toString()
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

function discordQuery(request: Request) {
  const params = new URL(request.url).searchParams
  return {
    code: params.get('code')?.trim() || null,
    state: params.get('state')?.trim() || null,
    guildId: params.get('guild_id')?.trim() || null,
    permissions: params.get('permissions')?.trim() || null,
    error: params.get('error')?.trim() || null,
    errorDescription: params.get('error_description')?.trim() || null,
  }
}

function syncErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'capability_sync_failed'
}

function installSuccessOutcome(guildName: string): DiscordInstallOutcome {
  return {
    status: 'success',
    stage: 'connected',
    message: 'Discord connected.',
    accountLogin: guildName,
  }
}

function installProviderErrorOutcome(args: {
  error: string
  errorDescription?: string | null
}): DiscordInstallOutcome {
  return {
    status: 'error',
    stage: args.error,
    message: args.errorDescription || `Discord install failed: ${args.error}`,
    errorCode: args.error,
  }
}

function missingCodeOutcome(): DiscordInstallOutcome {
  return {
    status: 'error',
    stage: 'missing_code',
    message: 'Discord setup callback is missing code',
    errorCode: 'missing_code',
  }
}

function recordDiscordSetupEvent(args: {
  db: DiscordSetupDb
  userId: string
  workspaceId: string
  flowId?: string | null
  outcome: DiscordInstallOutcome
}) {
  return Effect.gen(function* () {
    const event = yield* Effect.promise(() =>
      recordConnectorCallbackEvent({
        db: args.db,
        userId: args.userId,
        workspaceId: args.workspaceId,
        connectorId: 'discord',
        flowId: args.flowId,
        source: 'discord_bot',
        status: args.outcome.status,
        stage: args.outcome.stage,
        message: args.outcome.message,
        errorCode: args.outcome.errorCode,
        accountLogin: args.outcome.accountLogin,
      }),
    )

    if (event.isErr()) {
      return yield* new ConnectorDatabaseError({
        connectorId: 'discord',
        operation: 'install.record_callback',
        message: event.error.message,
        cause: event.error,
      })
    }

    return event.value
  })
}

function finishSuccessfulDiscordInstall(args: {
  db: DiscordSetupDb
  userId: string
  workspaceId: string
  guildName: string
}) {
  return Effect.gen(function* () {
    const syncResult = yield* Effect.promise(() =>
      syncCapabilities('discord', args.userId, args.workspaceId),
    )

    if (syncResult.isErr()) {
      yield* markDiscordInstallStatus({
        db: args.db,
        workspaceId: args.workspaceId,
        status: 'degraded',
      })
      const code = syncErrorCode(syncResult.error)
      return {
        status: 'degraded',
        stage: code,
        message: 'Discord connected. Tool sync needs attention.',
        errorCode: code,
        accountLogin: args.guildName,
      } satisfies DiscordInstallOutcome
    }

    return installSuccessOutcome(args.guildName)
  })
}

function finishDiscordSetupCallback(args: {
  db: DiscordSetupDb
  request: Request
  userId: string
  workspaceId: string
  flowId?: string | null
  query: ReturnType<typeof discordQuery>
}) {
  return Effect.gen(function* () {
    const config = yield* discordInstallConfig({ env: appEnv, request: args.request })
    const layer = Layer.mergeAll(
      makeDiscordHttpClientLayer(),
      makeDiscordBaseLayer({ botToken: config.botToken }),
    )

    const outcome = args.query.error
      ? installProviderErrorOutcome({
          error: args.query.error,
          errorDescription: args.query.errorDescription,
        })
      : args.query.code
        ? yield* completeDiscordBotInstallation({
            db: args.db,
            config,
            userId: args.userId,
            workspaceId: args.workspaceId,
            code: args.query.code,
            guildId: args.query.guildId,
            permissions: args.query.permissions,
          }).pipe(
            Effect.provide(layer),
            Effect.matchEffect({
              onFailure: (error: ConnectorError) =>
                Effect.succeed(discordInstallErrorToOutcome(error)),
              onSuccess: ({ guildName }) =>
                finishSuccessfulDiscordInstall({
                  db: args.db,
                  userId: args.userId,
                  workspaceId: args.workspaceId,
                  guildName,
                }),
            }),
          )
        : missingCodeOutcome()

    const event = yield* recordDiscordSetupEvent({
      db: args.db,
      userId: args.userId,
      workspaceId: args.workspaceId,
      flowId: args.flowId,
      outcome,
    })

    return { outcome, event }
  })
}

/**
 * Completes Discord's code callback and records a product-level outcome for the
 * connections UI. Provider failures become callback events; only state,
 * authorization, membership, and callback-ledger persistence stop the response.
 */
export const Route = createFileRoute('/api/discord/setup')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const query = discordQuery(request)
        if (!query.state) {
          return badRequest('Discord setup callback is missing state')
        }

        const stateResult = await Effect.runPromise(
          resolveDiscordSetupState({
            secret: appEnv.BETTER_AUTH_SECRET,
            state: query.state,
          }).pipe(
            Effect.match({
              onFailure: (error) => ({ ok: false as const, error }),
              onSuccess: (value) => ({ ok: true as const, value }),
            }),
          ),
        )
        if (!stateResult.ok) return badRequest(stateResult.error.message)

        const { userId, workspaceId, flowId } = stateResult.value
        if (!workspaceId) return badRequest('Workspace not found')

        if (!appEnv.ENVIRONMENT || appEnv.ENVIRONMENT !== 'development') {
          const session = await requireSession(appContext)
          if (!session) return unauthorized()
          if (session.user.id !== userId) return unauthorized()
        }

        const db = await appContext.db()
        const [membership] = await db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, workspaceId),
              eq(schema.member.userId, userId),
            ),
          )
          .limit(1)
        if (!membership) return unauthorized()

        const result = await Effect.runPromise(
          finishDiscordSetupCallback({
            db,
            request,
            userId,
            workspaceId,
            flowId,
            query,
          }).pipe(
            Effect.match({
              onFailure: (error) => ({ ok: false as const, error }),
              onSuccess: (value) => ({ ok: true as const, value }),
            }),
          ),
        )

        if (!result.ok) {
          const status = result.error instanceof ConnectorDecodeError ? 400 : 500
          return Response.json({ error: result.error.message }, { status })
        }

        return redirectToConnections(request, flowId)
      },
    },
  },
})
