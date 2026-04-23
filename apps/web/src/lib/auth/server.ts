import { createBetterAuth } from './instance'
import type { AppEnv } from '@/lib/server/env'
import { getDb } from '@/lib/server/db'

type AuthEnv = Pick<
  AppEnv,
  'DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'
>

export function createAuth(env: AuthEnv, request?: Request) {
  return createBetterAuth(getDb(env), {
    ...env,
    request,
  })
}
