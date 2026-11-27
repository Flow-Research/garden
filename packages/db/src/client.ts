import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getServerEnv } from '@garden/env'
import * as schema from './schema/index.js'

/** A Node database client from `DATABASE_URL`, for CLI tooling only. */
export function createNodeDb() {
  return drizzle(getServerEnv().DATABASE_URL, { schema })
}

export type GardenDatabase = NodePgDatabase<typeof schema>

export { schema }
