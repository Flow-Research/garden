import { parseServerEnv } from '@garden/env'
import { createAuth } from './lib/auth'

const env = parseServerEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  OPENCODE_GO_API_KEY: process.env.OPENCODE_GO_API_KEY,
  ENVIRONMENT: process.env.ENVIRONMENT,
})

if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
  throw new Error(
    'BETTER_AUTH_SECRET and BETTER_AUTH_URL must be set before loading auth CLI config',
  )
}

export const auth = createAuth({
  DATABASE_URL: env.DATABASE_URL,
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
})
