import { Effect, Result as EffectResult } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { Result, matchError } from 'better-result'
import { and, eq } from 'drizzle-orm'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  githubSetupQuerySchema,
  parseSearchParams,
} from '@/lib/server/validation/github'
import {
  syncCapabilities,
  type CapabilitySyncError,
} from '@/lib/server/capability-sync'
import { schema, type Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { captureApiFailure } from '@/lib/server/api-logging'
import {
  ConnectorCallbackDatabaseError,
  connectorCallbackSearchParams,
  recordConnectorCallbackEvent,
  type ConnectorCallbackStatus,
} from '@/lib/server/connector-callback-events'
import {
  completeGitHubAppInstallation,
  resolveGitHubSetupState,
} from '@/lib/server/github-app'

function isDevelopmentEnv() {
  return appEnv.ENVIRONMENT === 'development'
}

function redirectToConnections(request: Request, flowId?: string | null) {
  const requestOrigin =
    URL.parse(request.url)?.origin ?? 'http://localhost:3000'
  const redirectOrigin =
    isDevelopmentEnv() && appEnv.BETTER_AUTH_URL
      ? appEnv.BETTER_AUTH_URL
      : requestOrigin
  const url = new URL('/workspace', redirectOrigin)
  url.search = connectorCallbackSearchParams({
    connectorId: 'github',
    flowId,
  }).toString()
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}

type GitHubSetupDb = Db

type GitHubSetupOutcome = {
  status: ConnectorCallbackStatus
  stage: string
  message: string
  errorCode?: string | null
  accountLogin?: string | null
}

function gitHubInstallErrorToOutcome(error: {
  code: string
  message: string
}): GitHubSetupOutcome {
  return {
    status: 'error',
    stage: error.code,
    message: error.message,
    errorCode: error.code,
  }
}

function syncResultToGitHubOutcome(args: {
  accountLogin: string
  syncError?: CapabilitySyncError
}): GitHubSetupOutcome {
  if (args.syncError === undefined) {
    return {
      status: 'success',
      stage: 'connected',
      message: 'GitHub connected.',
      accountLogin: args.accountLogin,
    }
  }

  return {
    status: 'degraded',
    stage: args.syncError.code,
    message: 'GitHub connected. Tool sync needs attention.',
    errorCode: args.syncError.code,
    accountLogin: args.accountLogin,
  }
}

async function markGitHubInstallDegraded(args: {
  db: GitHubSetupDb
  workspaceId: string
}) {
  return Result.tryPromise({
    try: async () => {
      await args.db
        .update(schema.githubAppInstallation)
        .set({ status: 'degraded', updatedAt: new Date() })
        .where(eq(schema.githubAppInstallation.workspaceId, args.workspaceId))
    },
    catch: (cause) =>
      new ConnectorCallbackDatabaseError({
        operation: 'update',
        cause,
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to mark GitHub installation as degraded',
      }),
  })
}

async function recordGitHubSetupEvent(args: {
  db: GitHubSetupDb
  userId: string
  workspaceId: string
  flowId?: string | null
  outcome: GitHubSetupOutcome
}) {
  return await recordConnectorCallbackEvent({
    db: args.db,
    userId: args.userId,
    workspaceId: args.workspaceId,
    connectorId: 'github',
    flowId: args.flowId,
    source: 'github_app',
    status: args.outcome.status,
    stage: args.outcome.stage,
    message: args.outcome.message,
    errorCode: args.outcome.errorCode,
    accountLogin: args.outcome.accountLogin,
  })
}

/**
 * Completes the GitHub App callback as a typed callback workflow. Provider
 * install failures and capability sync failures are `Ok(error/degraded)`
 * product outcomes because the browser should show them from the callback
 * ledger. Only critical persistence failures stay `Err`. This follows the
 * better-result v2.9.2 source guidance on rich Ok outcomes plus boundary match.
 */
async function finishGitHubSetupCallback(args: {
  db: GitHubSetupDb
  userId: string
  workspaceId: string
  flowId?: string | null
  installationId: string
}) {
  return Result.gen(async function* () {
    const installResult = await completeGitHubAppInstallation({
      db: args.db,
      env: appEnv,
      userId: args.userId,
      workspaceId: args.workspaceId,
      installationId: args.installationId,
    })

    const outcome = yield* Result.await(
      Result.match(installResult, {
        ok: async ({ accountLogin }) => {
          const syncResult = await Effect.runPromise(
            Effect.result(
              syncCapabilities('github', args.userId, args.workspaceId),
            ),
          )
          if (EffectResult.isFailure(syncResult)) {
            await captureApiFailure({
              event: 'github.installation.capability_sync_failed',
              error: syncResult.failure,
              level: 'warn',
            })
          }
          const nextOutcome = syncResultToGitHubOutcome({
            accountLogin,
            syncError: EffectResult.isFailure(syncResult)
              ? syncResult.failure
              : undefined,
          })

          return nextOutcome.status === 'degraded'
            ? (
                await markGitHubInstallDegraded({
                  db: args.db,
                  workspaceId: args.workspaceId,
                })
              ).map(() => nextOutcome)
            : Result.ok(nextOutcome)
        },
        err: async (error) => {
          await captureApiFailure({
            event: 'github.installation.callback_failed',
            error,
          })
          return Result.ok(gitHubInstallErrorToOutcome(error))
        },
      }),
    )

    const event = yield* Result.await(
      recordGitHubSetupEvent({
        db: args.db,
        userId: args.userId,
        workspaceId: args.workspaceId,
        flowId: args.flowId,
        outcome,
      }),
    )

    return Result.ok({ outcome, event })
  })
}

export const Route = createFileRoute('/api/github/setup')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const query = parseSearchParams(
          request,
          githubSetupQuerySchema,
          'Invalid GitHub setup callback',
        )
        if (query.isErr()) return badRequest(query.error.message)

        if (!query.value.state) {
          return badRequest('GitHub setup callback is missing state')
        }

        const stateResult = await resolveGitHubSetupState({
          secret: appEnv.BETTER_AUTH_SECRET,
          state: query.value.state,
        })
        if (stateResult.isErr()) return badRequest(stateResult.error.message)

        const { userId, workspaceId, flowId } = stateResult.value
        if (!workspaceId) return badRequest('Workspace not found')

        if (!isDevelopmentEnv()) {
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

        const result = await finishGitHubSetupCallback({
          db,
          userId,
          workspaceId,
          flowId,
          installationId: query.value.installation_id,
        })

        return result.match({
          ok: () => redirectToConnections(request, flowId),
          err: (error) =>
            matchError(error, {
              ConnectorCallbackDatabaseError: (databaseError) =>
                Response.json(
                  { error: databaseError.message },
                  { status: 500 },
                ),
            }),
        })
      },
    },
  },
})
