import type { BetterAuthOptions, DBAdapter } from 'better-auth'
import {
  APIError,
  getAuthoritativeSessionFromCtx,
  getOAuthState,
} from 'better-auth/api'
import { tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { account, member, organization, session, user } from '@garden/db/schema'
import type { Db } from '@/lib/server/db'

const bindingSchema = z.object({
  userId: z.uuid(),
  workspaceId: z.uuid(),
  providerId: z.string(),
  sessionId: z.uuid(),
})

export type ConnectorBinding = z.infer<typeof bindingSchema>

function refused(): never {
  throw APIError.from('FORBIDDEN', {
    code: 'CONNECTOR_AUTHORITY_CHANGED',
    message: 'Start this connection again from the active workspace.',
  })
}

/** The server context is authenticated OAuth state, not client additionalData. */
export async function connectorCallbackBinding(providerIds: readonly string[]) {
  const context = tryGetCurrentAuthEndpointContext()
  if (context?.path !== '/callback/:id') return null
  const providerId = context.params?.id
  if (typeof providerId !== 'string' || !providerIds.includes(providerId))
    return null
  const state = await getOAuthState()
  const parsed = bindingSchema.safeParse(state?.serverContext?.gardenConnector)
  if (
    !parsed.success ||
    !state?.link ||
    state.link.userId !== parsed.data.userId ||
    providerId !== parsed.data.providerId
  )
    refused()
  return { binding: parsed.data, context }
}

/**
 * Delegates normal auth to the supported Drizzle adapter. Connector account
 * writes use one transaction, including the authority locks and final write.
 * The advisory lock also serializes an account identity that has no row yet.
 */
export function connectorAccountAdapter(
  db: Db,
  schema: NonNullable<Parameters<typeof drizzleAdapter>[1]['schema']>,
  providerIds: readonly string[],
) {
  const delegate = drizzleAdapter(db, {
    provider: 'pg',
    schema,
    transaction: false,
  })
  return (options: BetterAuthOptions): DBAdapter => {
    const adapter = delegate(options)
    async function authorizedWrite<T>(
      model: string,
      operation: 'create' | 'update',
      data: Record<string, unknown>,
      targetId: unknown,
      write: (scoped: DBAdapter) => Promise<T>,
    ): Promise<T> {
      if (model !== 'account') return write(adapter)
      const callback = await connectorCallbackBinding(providerIds)
      if (!callback) return write(adapter)
      if (operation === 'update' && typeof targetId !== 'string') refused()
      const { binding, context } = callback
      const browserSession = await getAuthoritativeSessionFromCtx(
        context as Parameters<typeof getAuthoritativeSessionFromCtx>[0],
      )
      if (
        !browserSession ||
        browserSession.session.id !== binding.sessionId ||
        browserSession.user.id !== binding.userId
      )
        refused()
      return db.transaction(async (tx) => {
        const target =
          typeof targetId === 'string'
            ? (
                await tx.select().from(account).where(eq(account.id, targetId))
              )[0]
            : undefined
        if (targetId !== undefined && !target) refused()
        const remoteId = target?.accountId ?? data.accountId
        if (
          typeof remoteId !== 'string' ||
          data.providerId !== binding.providerId
        )
          refused()
        // All connector writes take these locks in the same order. An absent
        // identity needs this shared lock before checking for duplicate rows.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['garden.connector-account', binding.providerId, remoteId])}, 0))`,
        )
        const [owner] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, binding.userId))
          .for('key share')
        const identities = await tx
          .select()
          .from(account)
          .where(
            and(
              eq(account.providerId, binding.providerId),
              eq(account.accountId, remoteId),
            ),
          )
          .for('update')
        const [workspace] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, binding.workspaceId))
          .for('key share')
        const [liveSession] = await tx
          .select()
          .from(session)
          .where(eq(session.id, binding.sessionId))
          .for('update')
        const [membership] = await tx
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.userId, binding.userId),
              eq(member.organizationId, binding.workspaceId),
            ),
          )
          .for('update')
        if (
          !owner ||
          !workspace ||
          !membership ||
          !liveSession ||
          liveSession.userId !== binding.userId ||
          liveSession.token !== browserSession.session.token ||
          liveSession.activeOrganizationId !== binding.workspaceId ||
          liveSession.expiresAt.getTime() <= Date.now()
        )
          refused()
        if (target) {
          const locked = identities.find(
            (identity) => identity.id === target.id,
          )
          if (
            !locked ||
            locked.userId !== binding.userId ||
            (locked.workspaceId !== null &&
              locked.workspaceId !== binding.workspaceId)
          )
            refused()
        } else if (identities.length > 0 || data.userId !== binding.userId)
          refused()
        if (
          data.workspaceId !== binding.workspaceId ||
          (data.userId !== undefined && data.userId !== binding.userId) ||
          (data.accountId !== undefined && data.accountId !== remoteId)
        )
          refused()
        const scoped = drizzleAdapter(tx, { provider: 'pg', schema })(options)
        const result = await write(scoped)
        if (result === null || result === undefined) refused()
        if (liveSession.expiresAt.getTime() <= Date.now()) refused()
        return result
      })
    }
    const guarded: DBAdapter = {
      ...adapter,
      // Keep the SDK's existing transaction:false behavior. Its fallback must
      // receive this adapter so nested auth operations retain the write guard.
      transaction: (callback) => adapter.transaction(() => callback(guarded)),
      create: (input) =>
        authorizedWrite(
          input.model,
          'create',
          input.data,
          undefined,
          (scoped) => scoped.create(input),
        ),
      update: (input) =>
        authorizedWrite(
          input.model,
          'update',
          input.update,
          input.where.length === 1
            ? input.where.find(
                (condition) =>
                  condition.field === 'id' &&
                  (condition.operator === undefined ||
                    condition.operator === 'eq'),
              )?.value
            : undefined,
          (scoped) => scoped.update(input),
        ),
    }
    return guarded
  }
}
