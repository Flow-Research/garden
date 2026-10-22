import { createBetterAuth } from './instance'
import type { AppEnv } from '@/lib/server/env'
import { getDb } from '@/lib/server/db'

type AuthEnv = Pick<
  AppEnv,
  | 'HYPERDRIVE'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'GOOGLE_AUTH_CLIENT_ID'
  | 'GOOGLE_AUTH_CLIENT_SECRET'
  | 'RESEND_API_KEY'
>

/** Builds Better Auth with the request-scoped Garden database client. */
export async function createAuth(env: AuthEnv, request?: Request) {
  return createBetterAuth(await getDb(env), {
    ...env,
    request,
  })
}

/**
 * Builds the auth instance used before an agent WebSocket enters its Durable
 * Object. Before this boundary, agent authorization constructed optional
 * Google and connector providers, so a bad provider configuration returned a
 * 500 before Garden could verify the session. Session mode keeps the shared
 * session database, cookie, and origin configuration without optional provider
 * plugins. Reference: issue #122 and `authorizeAgentRequest` in `server.ts`.
 */
export async function createSessionAuth(env: AuthEnv, request?: Request) {
  return createBetterAuth(await getDb(env), {
    ...env,
    request,
    authMode: 'session',
  })
}
