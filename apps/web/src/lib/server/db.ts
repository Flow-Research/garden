import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '@accelerate/db/schema'
import type { AppEnv } from '@/lib/server/env'

export function getDb(env: Pick<AppEnv, 'DATABASE_URL'>) {
  const client = neon(env.DATABASE_URL)
  return drizzle(client, { schema })
}

export { schema }
