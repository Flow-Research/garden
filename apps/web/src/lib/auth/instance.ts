import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import {
  account,
  invitation,
  member as memberTable,
  organization as organizationTable,
  session,
  user,
  verification,
} from '@garden/db/schema'
import type { AppEnv } from '@/lib/server/env'

export type GardenAuthEnv = Pick<
  AppEnv,
  'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'
>

type AuthDatabase = Parameters<typeof drizzleAdapter>[0]

const authSchema = {
  user,
  session,
  account,
  verification,
  organization: organizationTable,
  member: memberTable,
  invitation,
}

export function createBetterAuth(db: AuthDatabase, env: GardenAuthEnv) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    trustedOrigins: [
      'http://localhost:3000',
      'http://localhost:3001',
      ...(env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : []),
    ],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      organization({
        schema: {
          session: {
            fields: {
              activeOrganizationId: 'activeOrganizationId',
            },
          },
          organization: {
            fields: {
              createdAt: 'createdAt',
              logo: 'logo',
              metadata: 'metadata',
            },
            additionalFields: {
              description: { type: 'string', required: false, input: true },
              context: { type: 'string', required: false, input: true },
              settings: { type: 'json', required: false, input: true },
              plan: { type: 'string', required: false, input: true },
              updatedAt: { type: 'date', required: false },
            },
          },
        },
      }),
    ],
    user: {
      fields: {
        image: 'avatarUrl',
        emailVerified: 'emailVerified',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      },
    },
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  })
}
