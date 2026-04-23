import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq } from 'drizzle-orm'
import { organization } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { connectorRegistry } from '@garden/connectors'
import { buildConnectorOAuthConfigs } from '@garden/connectors/oauth'
import {
  account,
  invitation,
  member as memberTable,
  organization as organizationTable,
  session,
  user,
  verification,
} from '@garden/db/schema'
import { syncCapabilities } from '@/lib/server/capability-sync'
import type { AppEnv } from '@/lib/server/env'

export type GardenAuthEnv = Pick<
  AppEnv,
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'GITHUB_CLIENT_ID'
  | 'GITHUB_CLIENT_SECRET'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'SLACK_CLIENT_ID'
  | 'SLACK_CLIENT_SECRET'
>

type AuthDatabase = Parameters<typeof drizzleAdapter>[0]
type AccountRecord = typeof account.$inferInsert
type HookSession = {
  session: {
    activeOrganizationId?: string | null
  }
  user: {
    id: string
  }
}
type HookContext = {
  params?: Record<string, unknown>
  path?: string
  context: {
    logger: {
      error: (...args: unknown[]) => void
    }
    newSession: HookSession | null
    session: HookSession | null
  }
} | null

const authSchema = {
  user,
  session,
  account,
  verification,
  organization: organizationTable,
  member: memberTable,
  invitation,
}

function getConnectorByProviderId(providerId: string | null | undefined) {
  return connectorRegistry.find(
    (connector) => connector.oauth?.providerId === providerId,
  )
}

function readHookSession(context: HookContext) {
  return context?.context.session ?? context?.context.newSession ?? null
}

function readProviderId(
  accountRecord: Partial<AccountRecord>,
  context: HookContext,
) {
  const routeProviderId = context?.params?.providerId
  if (typeof accountRecord.providerId === 'string') {
    return accountRecord.providerId
  }

  return typeof routeProviderId === 'string' ? routeProviderId : undefined
}

function normalizeScopes(scope: string | null | undefined) {
  const scopes = scope
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return scopes && scopes.length > 0 ? scopes : undefined
}

function decorateAccountRecord(
  accountRecord: Partial<AccountRecord>,
  context: HookContext,
) {
  const providerId = readProviderId(accountRecord, context)
  const connector = getConnectorByProviderId(providerId)
  if (!connector) return undefined

  const workspaceId = readHookSession(context)?.session.activeOrganizationId
  const scopes = normalizeScopes(accountRecord.scope)

  return {
    ...accountRecord,
    connectorType: connector.id,
    status: 'connected',
    ...(workspaceId ? { workspaceId } : {}),
    ...(scopes ? { scopes } : {}),
  }
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
    databaseHooks: {
      account: {
        create: {
          before: async (accountRecord, context) => {
            const decoratedAccount = decorateAccountRecord(
              accountRecord,
              context as HookContext,
            )

            return decoratedAccount ? { data: decoratedAccount } : undefined
          },
        },
        update: {
          before: async (accountRecord, context) => {
            const decoratedAccount = decorateAccountRecord(
              accountRecord,
              context as HookContext,
            )

            return decoratedAccount ? { data: decoratedAccount } : undefined
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    account: {
      encryptOAuthTokens: true,
      updateAccountOnSignIn: true,
      additionalFields: {
        workspaceId: { type: 'string', required: false, input: false },
        status: { type: 'string', required: false, input: false },
        scopes: { type: 'string[]', required: false, input: false },
        connectorType: { type: 'string', required: false, input: false },
      },
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
      genericOAuth({
        config: buildConnectorOAuthConfigs(
          env as Record<string, string | undefined>,
        ),
      }),
    ],
    hooks: {
      after: createAuthMiddleware(async (context) => {
        if (context.path !== '/oauth2/callback/:providerId') {
          return
        }

        const providerId =
          typeof context.params?.providerId === 'string'
            ? context.params.providerId
            : undefined
        const connector = getConnectorByProviderId(providerId)
        const session = readHookSession(context as HookContext)
        const workspaceId = session?.session.activeOrganizationId
        const userId = session?.user.id

        if (!providerId || !connector || !workspaceId || !userId) {
          return
        }

        const syncResult = await syncCapabilities(
          connector.id,
          userId,
          workspaceId,
        )

        if (syncResult.isOk()) {
          return
        }

        context.context.logger.error(syncResult.error.message, syncResult.error, {
          connectorId: connector.id,
          providerId,
          userId,
          workspaceId,
        })

        await db
          .update(account)
          .set({
            status: 'degraded',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(account.userId, userId),
              eq(account.providerId, providerId),
              eq(account.workspaceId, workspaceId),
            ),
          )
      }),
    },
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
