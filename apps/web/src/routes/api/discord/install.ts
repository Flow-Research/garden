import { Effect } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import type { Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  connectorCallbackSearchParams,
  recordConnectorCallbackEvent,
} from '@/lib/server/connector-callback-events'
import {
  buildDiscordInstallRedirect,
  hasConnectedDiscordInstall,
} from '@/lib/server/discord-install'
import { ConnectorDatabaseError } from '@garden/connectors/effect/errors'

function readConnectorFlowId(request: Request) {
  const value = new URL(request.url).searchParams.get('connector_flow')?.trim()
  return value || null
}

function redirectToDiscordPanel(request: Request, flowId?: string | null) {
  const url = new URL('/workspace', request.url)
  url.search = connectorCallbackSearchParams({
    connectorId: 'discord',
    flowId,
  }).toString()
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

function redirectToDiscord(location: string) {
  return new Response(null, {
    status: 302,
    headers: { location },
  })
}

function recordAlreadyConnectedEvent(args: {
  db: Db
  userId: string
  workspaceId: string
  flowId?: string | null
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
        status: 'success',
        stage: 'already_connected',
        message: 'Discord is already connected.',
      }),
    )

    if (event.isErr()) {
      return yield* new ConnectorDatabaseError({
        connectorId: 'discord',
        operation: 'install.record_already_connected',
        message: event.error.message,
        cause: event.error,
      })
    }
  })
}

/**
 * Starts Discord's advanced bot install flow. GitHub has provider-owned install
 * callbacks; Discord's basic bot flow is callback-less, so Garden requests a
 * code flow and signs workspace state before redirecting.
 */
export const Route = createFileRoute('/api/discord/install')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return badRequest('Workspace not found')

        const flowId = readConnectorFlowId(request)
        const db = await appContext.db()

        const program = Effect.gen(function* () {
          const connected = yield* hasConnectedDiscordInstall({ db, workspaceId })
          if (connected) {
            yield* recordAlreadyConnectedEvent({
              db,
              userId: session.user.id,
              workspaceId,
              flowId,
            })
            return redirectToDiscordPanel(request, flowId)
          }

          const location = yield* buildDiscordInstallRedirect({
            env: appEnv,
            request,
            userId: session.user.id,
            workspaceId,
            flowId,
          })
          return redirectToDiscord(location)
        })

        return await Effect.runPromise(
          program.pipe(
            Effect.match({
              onFailure: (error) =>
                Response.json({ error: error.message }, { status: 500 }),
              onSuccess: (response) => response,
            }),
          ),
        )
      },
    },
  },
})
