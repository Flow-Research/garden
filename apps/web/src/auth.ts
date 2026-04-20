import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import {
  account,
  session,
  verification,
  member as memberTable,
  organization as organizationTable,
  invitation,
  user,
} from '../../../packages/db/src/schema/index.ts'
import { createBetterAuth } from './lib/auth-instance'

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://user:password@localhost:5432/garden'

const db = drizzle(neon(databaseUrl), {
  schema: {
    user,
    session,
    account,
    verification,
    organization: organizationTable,
    member: memberTable,
    invitation,
  },
})

export const auth = createBetterAuth(db, {
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ??
    'garden-dev-secret-please-change-me-123456',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
})
