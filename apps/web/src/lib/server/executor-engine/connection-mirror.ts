import { Effect, Option, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { getConnectorByExecutorSlug } from '@garden/connectors/registry'
import { getDb, schema } from '../db'
import { appEnv } from '../env'

export class ConnectionMirrorError extends Schema.TaggedError<ConnectionMirrorError>()(
  'ConnectionMirrorError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

const mirrorProviderId = (executorSlug: string, connectionName: string) =>
  `executor:${executorSlug}:${connectionName}`

export type MirrorConnectionInput = {
  executorSlug: string
  connectionName: string
  userId: string
  workspaceId: string
  identityLabel?: string | null
  scopes?: string[] | null
  expiresAtMs?: number | null
}

export function mirrorRowValues(
  input: MirrorConnectionInput,
  connectorId: string,
  now: Date,
) {
  return {
    userId: input.userId,
    accountId: input.identityLabel ?? input.executorSlug,
    providerId: mirrorProviderId(input.executorSlug, input.connectionName),
    workspaceId: input.workspaceId,
    status: 'connected',
    scopes: input.scopes ?? [],
    accessTokenExpiresAt:
      input.expiresAtMs == null ? null : new Date(input.expiresAtMs),
    connectorType: connectorId,
    createdAt: now,
    updatedAt: now,
  }
}

export const mirrorExecutorConnection = Effect.fn('ConnectionMirror.mirror')(
  function* (input: MirrorConnectionInput) {
    const connector = getConnectorByExecutorSlug(input.executorSlug)
    if (!connector) return Option.none()
    const db = yield* Effect.tryPromise({
      try: async () => getDb(appEnv),
      catch: (cause) =>
        new ConnectionMirrorError({
          operation: 'open',
          message: 'Failed to open database for connection mirror',
          cause,
        }),
    })
    const now = new Date()
    const values = mirrorRowValues(input, connector.id, now)
    const updated = yield* Effect.tryPromise({
      try: async () =>
        db
          .update(schema.account)
          .set({
            accountId: values.accountId,
            status: values.status,
            scopes: values.scopes,
            accessTokenExpiresAt: values.accessTokenExpiresAt,
            connectorType: values.connectorType,
            updatedAt: values.updatedAt,
          })
          .where(
            and(
              eq(schema.account.userId, values.userId),
              eq(schema.account.providerId, values.providerId),
              eq(schema.account.workspaceId, values.workspaceId),
            ),
          )
          .returning({ id: schema.account.id }),
      catch: (cause) =>
        new ConnectionMirrorError({
          operation: 'update',
          message: 'Failed to update connection mirror row',
          cause,
        }),
    })
    if (updated.length > 0) return Option.some(connector.id)
    yield* Effect.tryPromise({
      try: async () => db.insert(schema.account).values(values),
      catch: (cause) =>
        new ConnectionMirrorError({
          operation: 'insert',
          message: 'Failed to insert connection mirror row',
          cause,
        }),
    })
    return Option.some(connector.id)
  },
)

export const unmirrorExecutorConnection = Effect.fn(
  'ConnectionMirror.unmirror',
)(function* (input: {
  executorSlug: string
  connectionName: string
  userId: string
  workspaceId: string
}) {
  const db = yield* Effect.tryPromise({
    try: async () => getDb(appEnv),
    catch: (cause) =>
      new ConnectionMirrorError({
        operation: 'open',
        message: 'Failed to open database for connection mirror',
        cause,
      }),
  })
  yield* Effect.tryPromise({
    try: async () =>
      db
        .delete(schema.account)
        .where(
          and(
            eq(schema.account.userId, input.userId),
            eq(
              schema.account.providerId,
              mirrorProviderId(input.executorSlug, input.connectionName),
            ),
            eq(schema.account.workspaceId, input.workspaceId),
          ),
        ),
    catch: (cause) =>
      new ConnectionMirrorError({
        operation: 'delete',
        message: 'Failed to delete connection mirror row',
        cause,
      }),
  })
})

export const markMirrorDegraded = Effect.fn('ConnectionMirror.degraded')(
  function* (input: {
    executorSlug: string
    connectionName: string
    userId: string
    workspaceId: string
  }) {
    const db = yield* Effect.tryPromise({
      try: async () => getDb(appEnv),
      catch: (cause) =>
        new ConnectionMirrorError({
          operation: 'open',
          message: 'Failed to open database for connection mirror',
          cause,
        }),
    })
    yield* Effect.tryPromise({
      try: async () =>
        db
          .update(schema.account)
          .set({ status: 'degraded', updatedAt: new Date() })
          .where(
            and(
              eq(schema.account.userId, input.userId),
              eq(
                schema.account.providerId,
                mirrorProviderId(input.executorSlug, input.connectionName),
              ),
              eq(schema.account.workspaceId, input.workspaceId),
            ),
          ),
      catch: (cause) =>
        new ConnectionMirrorError({
          operation: 'update',
          message: 'Failed to mark connection mirror degraded',
          cause,
        }),
    })
  },
)
