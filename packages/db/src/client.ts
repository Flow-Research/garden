import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { serverEnv } from '@garden/env'
import * as schema from './schema/index.js'

export const db = drizzle(serverEnv.DATABASE_URL, { schema })

export type GardenDatabase = NodePgDatabase<typeof schema>

export { schema }
