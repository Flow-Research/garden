import { createAuth } from '@/lib/auth'
import type { AppEnv } from '@/lib/server/env'

export type GardenAuth = ReturnType<typeof createAuth>
export type GardenAuthSession = Awaited<
  ReturnType<GardenAuth['api']['getSession']>
>

export type GardenAuthState = {
  getAuth: () => GardenAuth
  getSession: () => Promise<GardenAuthSession>
}

export type AppRequestContext = {
  env: AppEnv
  request: Request
  auth: GardenAuthState
}

/**
 * Creates a Better Auth facade scoped to one incoming Worker request.
 * Before Garden used `appEnv` plus ad hoc `createAuth` calls, so login could
 * set a cookie while loaders rebuilt auth without request origin and threw
 * redirects/Unauthorized. This keeps auth, session, and request headers bound
 * together for the whole Start request. Reference: TanStack Start request
 * context and Better Auth request-bound handlers.
 */
export function createAuthState(env: AppEnv, request: Request): GardenAuthState {
  let auth: GardenAuth | undefined
  let session: Promise<GardenAuthSession> | undefined

  const getAuth = () => {
    auth ??= createAuth(env, request)
    return auth
  }

  return {
    getAuth,
    getSession: () => {
      session ??= getAuth().api.getSession({ headers: request.headers })
      return session
    },
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
  return {
    env,
    request,
    auth: createAuthState(env, request),
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
