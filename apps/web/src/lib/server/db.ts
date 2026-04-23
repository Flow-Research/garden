import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from '@garden/db/schema'
import type { AppEnv } from '@/lib/server/env'

export function getDb(env: Pick<AppEnv, 'DATABASE_URL'>) {
  return drizzle(env.DATABASE_URL, { schema })
}

export { schema }
