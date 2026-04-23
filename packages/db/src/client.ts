import { drizzle } from 'drizzle-orm/neon-serverless'
import { serverEnv } from '@garden/env'
import * as schema from './schema/index.js'

export const db = drizzle(serverEnv.DATABASE_URL, { schema })

export { schema }
