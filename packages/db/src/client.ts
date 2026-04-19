import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { serverEnv } from '@accelerate/env'
import * as schema from './schema/index.js'

const client = neon(serverEnv.DATABASE_URL)

export const db = drizzle(client, { schema })

export { schema }
