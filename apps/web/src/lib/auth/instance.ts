import { Effect, Result as EffectResult } from 'effect'
import { betterAuth } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from 'better-auth/api'
import { Result, matchError } from 'better-result'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq } from 'drizzle-orm'
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'
import { organization } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { connectorRegistry } from '@garden/connectors'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { buildConnectorOAuthConfigs } from '@garden/connectors/oauth'
import {
  createGardenLogger,
  type GardenLogLevel,
} from '@garden/observability/logger'
import {
  account,
  invitation,
  member as memberTable,
  organization as organizationTable,
  session,
  user,
  verification,
} from '@garden/db/schema'
import {
  syncCapabilities,
  type CapabilitySyncError,
} from '@/lib/server/capability-sync'
import {
  ConnectorCallbackDatabaseError,
  recordConnectorCallbackEvent,
  type ConnectorCallbackStatus,
} from '@/lib/server/connector-callback-events'
import type { AppEnv } from '@/lib/server/env'
import {
  capturePostHogEventWithScheduler,
  capturePostHogHandledErrorWithScheduler,
} from '@/lib/posthog-server'
import type { Db } from '@/lib/server/db'
import { sendPasswordResetEmail } from '@/lib/server/email/password-reset'
import { hasPasswordSignInMethod } from '@/lib/auth/sign-in-methods'

export type GardenAuthEnv = Pick<
  AppEnv,
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'GITHUB_CLIENT_ID'
  | 'GITHUB_CLIENT_SECRET'
  | 'GOOGLE_AUTH_CLIENT_ID'
  | 'GOOGLE_AUTH_CLIENT_SECRET'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'SLACK_CLIENT_ID'
  | 'SLACK_CLIENT_SECRET'
  | 'RESEND_API_KEY'
  | 'ENVIRONMENT'
  | 'VITE_PUBLIC_POSTHOG_HOST'
  | 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN'
>

type GardenAuthRuntime = GardenAuthEnv & {
  request?: Request
  waitUntil?: (promise: Promise<unknown>) => void
  authMode?: 'full' | 'session'
}

type AuthDatabase = Db
type AccountRecord = typeof account.$inferInsert
type HookSession = {
  session: {
    activeOrganizationId?: string | null
  }
  user: {
    id: string
  }
}
type HookContext = {
  params?: Record<string, unknown>
  path?: string
  context: {
    logger: {
      error: (...args: unknown[]) => void
    }
    newSession: HookSession | null
    session: HookSession | null
  }
} | null

const authSchema = {
  user,
  session,
  account,
  verification,
  organization: organizationTable,
  member: memberTable,
  invitation,
}

const betterAuthLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'better-auth',
})

/**
 * Replaces Better Auth's default console logger with Garden's redacting error
 * logger. The default logger printed Drizzle query params, which exposed session
 * tokens in Cloudflare logs during auth-session DB failures. Keeping Better Auth
 * at `level: 'error'` preserves actionable failures only; Garden's logger then
 * redacts params/cookies and indexes the sanitized args. References: Better Auth
 * logger option source and local Cloudflare Workers structured logging helper.
 */
function logBetterAuthError(
  level: Exclude<GardenLogLevel, 'success'>,
  message: string,
  ...args: unknown[]
) {
  if (level !== 'error') return
  betterAuthLogger.error('better_auth.error', {
    betterAuthMessage: message,
    ...(args.length > 0 ? { betterAuthArgs: args } : {}),
  })
}

const gardenAccessControl = createAccessControl({
  ...defaultStatements,
  agent: ['create', 'update', 'delete'],
  connection: ['update'],
  issue: ['update'],
  permission: ['approve', 'grant'],
  skill: ['create', 'update', 'delete'],
})

const gardenOwnerRole = gardenAccessControl.newRole({
  ...defaultStatements,
  agent: ['create', 'update', 'delete'],
  connection: ['update'],
  issue: ['update'],
  permission: ['approve', 'grant'],
  skill: ['create', 'update', 'delete'],
})

const gardenAdminRole = gardenAccessControl.newRole({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  agent: ['create', 'update', 'delete'],
  connection: ['update'],
  issue: ['update'],
  permission: ['approve', 'grant'],
  skill: ['create', 'update', 'delete'],
})

const gardenMemberRole = gardenAccessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ['read'],
  agent: [],
  connection: [],
  issue: [],
  permission: [],
  skill: [],
})

function getConnectorByProviderId(providerId: string | null | undefined) {
  return connectorRegistry.find(
    (connector) => connector.oauth?.providerId === providerId,
  )
}

function readHookSession(context: HookContext) {
  return context?.context.session ?? context?.context.newSession ?? null
}

function readProviderId(
  accountRecord: Partial<AccountRecord>,
  context: HookContext,
) {
  const routeProviderId = context?.params?.providerId
  if (typeof accountRecord.providerId === 'string') {
    return accountRecord.providerId
  }

  return typeof routeProviderId === 'string' ? routeProviderId : undefined
}

function normalizeScopes(scope: string | null | undefined) {
  const scopes = scope
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return scopes && scopes.length > 0 ? scopes : undefined
}

function decorateAccountRecord(
  accountRecord: Partial<AccountRecord>,
  context: HookContext,
) {
  const providerId = readProviderId(accountRecord, context)
  const connector = getConnectorByProviderId(providerId)
  if (!connector) return undefined

  const workspaceId = readHookSession(context)?.session.activeOrganizationId
  const scopes = normalizeScopes(accountRecord.scope)

  return {
    ...accountRecord,
    connectorType: connector.id,
    status: 'connected',
    ...(workspaceId ? { workspaceId } : {}),
    ...(scopes ? { scopes } : {}),
  }
}

function getRequestOrigin(request?: Request) {
  if (!request || !URL.canParse(request.url)) return null
  return new URL(request.url).origin
}

function readOAuthCallbackFlow(
  callbackURL: string | undefined,
  baseURL: string,
) {
  if (!callbackURL || !URL.canParse(callbackURL, baseURL)) {
    return { flowId: undefined }
  }

  const url = new URL(callbackURL, baseURL)
  const flowId = url.searchParams.get('connector_flow')?.trim() || undefined
  return { flowId }
}

type OAuthCallbackOutcome = {
  status: ConnectorCallbackStatus
  stage: string
  message: string
  errorCode?: string | null
}

function syncResultToOAuthOutcome(args: {
  connectorLabel: string
  syncError?: CapabilitySyncError
}): OAuthCallbackOutcome {
  if (args.syncError === undefined) {
    return {
      status: 'success',
      stage: 'connected',
      message: `${args.connectorLabel} connected.`,
    }
  }

  return {
    status: 'degraded',
    stage: args.syncError.code,
    message: `${args.connectorLabel} connected. Tool sync needs attention.`,
    errorCode: args.syncError.code,
  }
}

async function markOAuthAccountDegraded(args: {
  db: AuthDatabase
  userId: string
  workspaceId: string
  providerId: string
}) {
  return Result.tryPromise({
    try: async () => {
      await args.db
        .update(account)
        .set({
          status: 'degraded',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(account.userId, args.userId),
            eq(account.providerId, args.providerId),
            eq(account.workspaceId, args.workspaceId),
          ),
        )
    },
    catch: (cause) =>
      new ConnectorCallbackDatabaseError({
        operation: 'update',
        cause,
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to mark OAuth account as degraded',
      }),
  })
}

/**
 * Converts Better Auth's OAuth callback hook into a single typed callback
 * workflow. Previously the hook treated capability sync failure as an error
 * branch and duplicated event writes; after reading better-result v2.9.2 source,
 * sync failure is modeled as an `Ok(degraded)` product outcome while DB/event
 * persistence stays `Err`. This keeps callbacks non-blocking beyond critical
 * writes and avoids URL/tab state as product state.
 */
async function finishOAuthConnectorCallback(args: {
  db: AuthDatabase
  userId: string
  workspaceId: string
  providerId: string
  connectorId: NonNullable<ReturnType<typeof getConnectorByProviderId>>['id']
  connectorLabel: string
  flowId?: string | null
}) {
  return Result.gen(async function* () {
    const syncResult = await Effect.runPromise(
      Effect.result(
        syncCapabilities(args.connectorId, args.userId, args.workspaceId),
      ),
    )
    const outcome = syncResultToOAuthOutcome({
      connectorLabel: args.connectorLabel,
      syncError: EffectResult.isFailure(syncResult)
        ? syncResult.failure
        : undefined,
    })

    if (outcome.status === 'degraded') {
      yield* Result.await(
        markOAuthAccountDegraded({
          db: args.db,
          userId: args.userId,
          workspaceId: args.workspaceId,
          providerId: args.providerId,
        }),
      )
    }

    const event = yield* Result.await(
      recordConnectorCallbackEvent({
        db: args.db,
        userId: args.userId,
        workspaceId: args.workspaceId,
        connectorId: args.connectorId,
        providerId: args.providerId,
        flowId: args.flowId,
        source: 'oauth',
        status: outcome.status,
        stage: outcome.stage,
        message: outcome.message,
        errorCode: outcome.errorCode,
      }),
    )

    return Result.ok({ outcome, event })
  })
}

/**
 * Builds the Google sign-in provider from auth-only credentials. Connector
 * credentials are intentionally excluded because Better Auth asks Google to
 * include scopes previously granted to the same OAuth project. Before this
 * split, sign-in could share consent history with Gmail and Drive. A partial
 * pair is a deployment error because silently disabling Google would make the
 * configured UI and server behavior disagree. Reference: Better Auth 1.6.26
 * Google provider source and Google's incremental authorization guidance.
 */
function googleAuthProvider(env: GardenAuthRuntime) {
  const clientId = env.GOOGLE_AUTH_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_AUTH_CLIENT_SECRET?.trim()

  if (!clientId && !clientSecret) return undefined
  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_AUTH_CLIENT_ID and GOOGLE_AUTH_CLIENT_SECRET must be set together',
    )
  }

  return {
    google: {
      clientId,
      clientSecret,
    },
  }
}

/**
 * Builds the full Better Auth instance or the optional-provider-free instance
 * used by agent transport authorization. Before this split, a partial optional
 * Google OAuth credential pair threw while `/agents/*` requests were only
 * trying to verify a session. The session mode keeps the database, cookie,
 * origin, and session configuration while skipping social and connector OAuth
 * providers.
 * References: issue #122, Better Auth `getSession` API, and Cloudflare Worker
 * request-boundary guidance.
 */
export function createBetterAuth(db: AuthDatabase, env: GardenAuthRuntime) {
  const useOptionalProviders = env.authMode !== 'session'
  const runtimeOrigin = getRequestOrigin(env.request)
  const baseURL =
    runtimeOrigin ?? env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  const trustedOrigins = Array.from(
    new Set([
      'http://localhost:3000',
      'http://localhost:3001',
      ...(env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : []),
      ...(runtimeOrigin ? [runtimeOrigin] : []),
    ]),
  )
  const oauthEnv = {
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET,
  } satisfies Record<string, string | undefined>

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins,
    logger: {
      level: 'error',
      log: logBetterAuthError,
    },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: authSchema,
    }),
    session: {
      cookieCache: {
        enabled: true,
        strategy: 'compact',
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (accountRecord, context) => {
            const decoratedAccount = decorateAccountRecord(
              accountRecord,
              context as HookContext,
            )

            return decoratedAccount ? { data: decoratedAccount } : undefined
          },
        },
        update: {
          before: async (accountRecord, context) => {
            const decoratedAccount = decorateAccountRecord(
              accountRecord,
              context as HookContext,
            )

            return decoratedAccount ? { data: decoratedAccount } : undefined
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: resetUser, url }) => {
        await sendPasswordResetEmail({
          env,
          resetUrl: url,
          user: {
            id: resetUser.id,
            email: resetUser.email,
            name: resetUser.name,
          },
        })
      },
    },
    account: {
      encryptOAuthTokens: true,
      updateAccountOnSignIn: true,
      accountLinking: {
        trustedProviders: ['google'],
        // Require the existing Garden account to verify its email before
        // trusted-provider linking. Otherwise, anyone can pre-register an
        // unverified password account with another person's email and claim
        // the account when that person later signs in with Google.
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
      additionalFields: {
        workspaceId: { type: 'string', required: false, input: false },
        status: { type: 'string', required: false, input: false },
        scopes: { type: 'string[]', required: false, input: false },
        connectorType: { type: 'string', required: false, input: false },
      },
    },
    socialProviders: useOptionalProviders
      ? googleAuthProvider(env)
      : undefined,
    plugins: [
      organization({
        ac: gardenAccessControl,
        roles: {
          owner: gardenOwnerRole,
          admin: gardenAdminRole,
          member: gardenMemberRole,
        },
        schema: {
          session: {
            fields: {
              activeOrganizationId: 'activeOrganizationId',
            },
          },
          organization: {
            fields: {
              createdAt: 'createdAt',
              logo: 'logo',
              metadata: 'metadata',
            },
            additionalFields: {
              description: { type: 'string', required: false, input: true },
              context: { type: 'string', required: false, input: true },
              settings: { type: 'json', required: false, input: true },
              plan: { type: 'string', required: false, input: true },
              updatedAt: { type: 'date', required: false },
            },
          },
        },
      }),
      ...(useOptionalProviders
        ? [
            genericOAuth({
              config: buildConnectorOAuthConfigs(oauthEnv),
            }),
          ]
        : []),
    ],
    hooks: {
      /**
       * Enforces Garden's sign-in-method unlink policy before Better Auth runs
       * its account-count check and delete as separate operations. Garden's
       * connector accounts share `auth_account` with sign-in methods, and
       * concurrent Google and credential unlink requests could otherwise each
       * observe the other method and delete both. Garden does not support
       * removing password sign-in, while Google unlink requires a password
       * account to remain. Reference: Better Auth 1.6.26 `unlinkAccount` route
       * and `getSessionFromCtx` source.
       */
      before: createAuthMiddleware(async (context) => {
        if (context.path !== '/unlink-account') {
          return
        }

        const providerId = context.body?.providerId
        if (providerId !== 'credential' && providerId !== 'google') return

        const session = await getSessionFromCtx(context)
        if (!session) return

        if (providerId === 'credential') {
          throw APIError.from('BAD_REQUEST', {
            code: 'CREDENTIAL_UNLINK_NOT_SUPPORTED',
            message: 'Password sign-in cannot be removed',
          })
        }

        const accounts = await context.context.internalAdapter.findAccounts(
          session.user.id,
        )
        if (!hasPasswordSignInMethod(accounts)) {
          throw APIError.from('BAD_REQUEST', {
            code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
            message: 'Google is your only sign-in method',
          })
        }
      }),
      after: createAuthMiddleware(async (context) => {
        if (context.path !== '/oauth2/callback/:providerId') {
          return
        }

        const providerId =
          typeof context.params?.providerId === 'string'
            ? context.params.providerId
            : undefined
        const connector = getConnectorByProviderId(providerId)
        const session = readHookSession(context as HookContext)
        const workspaceId = session?.session.activeOrganizationId
        const userId = session?.user.id

        if (!providerId || !connector || !workspaceId || !userId) {
          return
        }

        const oauthState = await getOAuthState()
        const { flowId } = readOAuthCallbackFlow(
          oauthState?.callbackURL,
          baseURL,
        )
        const result = await finishOAuthConnectorCallback({
          db,
          userId,
          workspaceId,
          providerId,
          connectorId: connector.id,
          connectorLabel: connector.label,
          flowId,
        })

        result.match({
          ok: ({ event, outcome }) => {
            if (env.waitUntil) {
              capturePostHogEventWithScheduler(env, env.waitUntil, {
                distinctId: userId,
                event: GARDEN_ANALYTICS_EVENTS.connectorConnectionCompleted,
                workspaceId,
                uuid: event.id,
                properties: {
                  connector_id: connector.id,
                  provider_id: providerId,
                  callback_event_id: event.id,
                  flow_id: flowId,
                  source: 'oauth',
                  outcome: outcome.status,
                  stage: outcome.stage,
                  error_code: outcome.errorCode,
                },
              })
            }

            if (outcome.status === 'degraded') {
              context.context.logger.error(outcome.message, {
                connectorId: connector.id,
                providerId,
                userId,
                workspaceId,
                errorCode: outcome.errorCode,
              })
            }
          },
          err: (error) =>
            matchError(error, {
              ConnectorCallbackDatabaseError: (databaseError) => {
                if (env.waitUntil) {
                  capturePostHogHandledErrorWithScheduler(env, env.waitUntil, {
                    distinctId: userId,
                    workspaceId,
                    error: databaseError,
                    properties: {
                      operation: 'connector_callback',
                      connector_id: connector.id,
                      provider_id: providerId,
                      stage: 'callback_persistence',
                    },
                  })
                }
                context.context.logger.error(
                  databaseError.message,
                  databaseError,
                  {
                    connectorId: connector.id,
                    providerId,
                    userId,
                    workspaceId,
                  },
                )
              },
            }),
        })
      }),
    },
    user: {
      fields: {
        image: 'avatarUrl',
        emailVerified: 'emailVerified',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      },
    },
    advanced: {
      disableCSRFCheck: false,
      disableOriginCheck: false,
      database: {
        generateId: 'uuid',
      },
    },
  })
}
