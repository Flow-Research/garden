import { Result } from 'better-result'
import { createBetterAuth } from '@/lib/auth/instance'
import { createRequestDbProvider, type DbProvider } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'
import {
  createGardenLogger,
  errorFields,
  requestFields,
  type GardenLogFields,
} from '@garden/observability/logger'

export type GardenAuth = ReturnType<typeof createBetterAuth>
export type GardenAuthSession = Awaited<
  ReturnType<GardenAuth['api']['getSession']>
>

export type GardenAuthState = {
  getAuth: () => Promise<GardenAuth>
  getSession: () => Promise<GardenAuthSession>
  getCachedSession: () => Promise<GardenAuthSession> | undefined
}

export type AppRequestContext = {
  env: AppEnv
  request: Request
  db: DbProvider
  close: () => Promise<void>
  auth: GardenAuthState
}

const authSessionLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'auth-session',
})

function cookiePresenceFields(request: Request) {
  const cookie = request.headers.get('cookie') ?? ''
  const cookieNames = new Set(
    cookie
      .split(';')
      .map((entry) => entry.split('=')[0]?.trim())
      .filter((name): name is string => Boolean(name)),
  )

  return {
    hasCookieHeader: cookie.length > 0,
    hasSessionToken: cookieNames.has('better-auth.session_token'),
    hasSecureSessionToken: cookieNames.has(
      '__Secure-better-auth.session_token',
    ),
    hasLegacySessionToken: cookieNames.has('better-auth-session_token'),
    hasSessionData:
      cookieNames.has('better-auth.session_data') ||
      [...cookieNames].some((name) =>
        name.startsWith('__Secure-better-auth.session_data.'),
      ),
  }
}

/**
 * Resolves a Better Auth session with Garden-owned structured error logging.
 * Before this boundary, Better Auth logged Drizzle failures as lossy console text
 * (`Failed query ...`) and the underlying Neon/Postgres cause was not indexed in
 * Cloudflare. After this change, the same thrown error still reaches callers,
 * but Garden logs request, route, and cookie-presence context plus the sanitized
 * cause chain from `errorFields`. References: Better Auth session endpoint
 * source, Better Auth session cookie docs, and better-result v2.9.2
 * `Result.tryPromise` source for no-try/catch boundary wrapping.
 */
export async function getLoggedAuthSession(input: {
  auth: GardenAuth
  request: Request
  source: 'request-context' | 'route-helper' | 'agent-router'
  fields?: GardenLogFields
}) {
  const result = await Result.tryPromise({
    try: async () =>
      await input.auth.api.getSession({ headers: input.request.headers }),
    catch: (cause) => cause,
  })

  if (result.isErr()) {
    authSessionLogger.error('auth.session.lookup_failed', {
      ...requestFields(input.request),
      ...cookiePresenceFields(input.request),
      sessionLookupSource: input.source,
      ...input.fields,
      ...errorFields(result.error),
    })
    throw result.error
  }

  return result.value
}

/**
 * Creates a Better Auth facade scoped to one incoming Worker request.
 * Before Garden used `appEnv` plus ad hoc `createAuth` calls, so login could
 * set a cookie while loaders rebuilt auth without request origin and threw
 * redirects/Unauthorized. This keeps auth, session, and request headers bound
 * together for the whole Start request. Reference: TanStack Start request
 * context and Better Auth request-bound handlers.
 */
export function createAuthState(
  env: AppEnv,
  dbProvider: DbProvider,
  request: Request,
): GardenAuthState {
  let auth: Promise<GardenAuth> | undefined
  let session: Promise<GardenAuthSession> | undefined

  const getAuth = () => {
    if (!auth) {
      auth = dbProvider().then((db) =>
        createBetterAuth(db, {
          ...env,
          request,
        }),
      )
    }
    return auth
  }

  return {
    getAuth,
    getSession: () => {
      if (!session) {
        session = getAuth().then((auth) =>
          getLoggedAuthSession({
            auth,
            request,
            source: 'request-context',
          }),
        )
      }
      return session
    },
    getCachedSession: () => session,
  }
}

/**
 * Builds TanStack Start request context from Cloudflare bindings. Server
 * functions use this to read request-local auth instead of only the global
 * `appEnv` binding.
 */
export function createAppRequestContext(
  env: AppEnv,
  request: Request,
): AppRequestContext {
  const requestDb = createRequestDbProvider(env)

  return {
    env,
    request,
    db: requestDb.db,
    close: requestDb.close,
    auth: createAuthState(env, requestDb.db, request),
  }
}

/**
 * Narrows TanStack's optional server function context to Garden's required
 * request context. Missing context means the Worker entry failed to pass the
 * per-request app context into `handler.fetch`.
 */
export function requireAppRequestContext(
  context: AppRequestContext | undefined,
): AppRequestContext {
  if (!context) {
    throw new Error('Missing TanStack request context')
  }

  return context
}

declare module '@tanstack/react-router' {
  interface Register {
    server: {
      requestContext: AppRequestContext
    }
  }
}
