import { createBetterAuth } from './instance'
import type { AppEnv } from '@/lib/server/env'
import { getDb, type DbProvider } from '@/lib/server/db'

type AuthEnv = Pick<
  AppEnv,
  | 'HYPERDRIVE'
  | 'DATABASE_URL'
  | 'ENVIRONMENT'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'RESEND_API_KEY'
>

/**
 * Builds Better Auth with the caller's request-scoped Garden database when one
 * exists. The agent router previously opened a hidden second client here and
 * could not close it after the WebSocket handoff; accepting the request provider
 * lets authentication and authorization share one explicitly owned connection.
 */
export async function createAuth(
  env: AuthEnv,
  request?: Request,
  dbProvider?: DbProvider,
) {
  const db = await (dbProvider ? dbProvider() : getDb(env))
  return createBetterAuth(db, {
    ...env,
    request,
  })
}
