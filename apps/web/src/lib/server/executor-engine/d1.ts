// Adapted from Executor v1.5.40 apps/host-cloudflare/src/db/d1.ts (MIT).
import { Effect } from 'effect'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core'
import {
  createDrizzleRuntimeSchemaFromTables,
  ensureDrizzleRuntimeSchemaFromTables,
} from '@executor-js/fumadb/adapters/drizzle'
import {
  StorageError,
  collectTables,
  type BlobStore,
  type ExecutorDb,
  type FumaTables,
} from '@executor-js/sdk/core'
import { createExecutorFumaDb } from '@executor-js/sdk/host-internal'

import { makeR2BlobStore } from './r2'

const DB_NAMESPACE = 'garden-executor-connectors'
const DB_SCHEMA_VERSION = '1.0.0'

/** Reads the stored owner before the callback exchanges a provider code. */
export function pendingOAuthOwner(
  database: D1Database,
  input: { tenant: string; subject: string; state: string },
) {
  return Effect.tryPromise({
    try: async () => {
      const table = collectTables().oauth_session
      if (!table) throw new Error('Executor OAuth session table is unavailable')
      const rows = await drizzle(database).all<{ owner: string }>(
        sql`select owner from ${sql.identifier(table.names.sql)}
            where tenant = ${input.tenant} and state = ${input.state}
            and (owner = 'org' or (owner = 'user' and subject = ${input.subject}))
            limit 1`,
      )
      return rows[0]?.owner
    },
    catch: (cause) =>
      new StorageError({
        message: 'Failed to verify the pending OAuth owner',
        cause,
      }),
  })
}

type WorkstreamOAuthStorage = NonNullable<ExecutorDb['workstreamOAuthStorage']>

interface D1ExecutorDb extends ExecutorDb {
  readonly workstreamOAuthStorage: WorkstreamOAuthStorage
  readonly close: () => Promise<void>
  readonly blobs?: BlobStore
}

const workstreamOAuthStorage = (
  database: D1Database,
  tables: {
    connection: string
    tool: string
    definition: string
    pluginStorage: string
    oauthSession: string
  },
): WorkstreamOAuthStorage => {
  const connection = sql.identifier(tables.connection)
  const tool = sql.identifier(tables.tool)
  const definition = sql.identifier(tables.definition)
  const pluginStorage = sql.identifier(tables.pluginStorage)
  const oauthSession = sql.identifier(tables.oauthSession)
  const dialect = new SQLiteAsyncDialect()
  const batch = (statements: readonly SQL[]) =>
    database.batch(
      statements.map((statement) => {
        const query = dialect.sqlToQuery(statement)
        return database.prepare(query.sql).bind(...query.params)
      }),
    )
  const ownerScope = (key: Parameters<WorkstreamOAuthStorage['remove']>[0]) =>
    sql`tenant = ${key.tenant} and owner = ${key.owner} and subject = ${key.subject}`
  const scope = (key: Parameters<WorkstreamOAuthStorage['remove']>[0]) =>
    sql`${ownerScope(key)} and integration = ${key.integration}`
  const generation = (
    ...[key, items]: Parameters<WorkstreamOAuthStorage['remove']>
  ) =>
    sql`
      ${scope(key)} and name = ${key.name} and provider = ${items.provider}
      and json_extract(cast(item_ids as text), '$.token') = ${items.accessItemId}
      and refresh_item_id is ${items.refreshItemId}
    `
  const exists = (condition: SQL) =>
    sql`exists (select 1 from ${connection} where ${condition})`
  const deleteCredentials = (
    key: Parameters<WorkstreamOAuthStorage['remove']>[0],
    items: Parameters<WorkstreamOAuthStorage['remove']>[1],
    gate: SQL,
  ) =>
    sql`
      delete from ${pluginStorage}
      where ${ownerScope(key)} and plugin_id = 'encryptedSecrets' and collection = 'secrets'
        and key in (${items.accessItemId}, ${items.refreshItemId}) and ${gate}
    `

  return {
    write: ({
      key,
      next,
      accessCiphertext,
      refreshCiphertext,
      expiresAt,
      oauthScope,
      change,
    }) =>
      Effect.tryPromise({
        try: async () => {
          const now = Date.now()
          // Fuma uses seconds for dates and BLOB-encoded decimal or JSON values.
          const updatedAt = Math.floor(now / 1000)
          const expiry = expiresAt == null ? null : String(expiresAt)
          const nextItemIds = JSON.stringify({ token: next.accessItemId })
          const session =
            change.kind === 'mint'
              ? sql`
                  ${scope(key)} and name = ${key.name} and client_slug = ${change.oauthClient}
                  and state = ${change.sessionState} and cast(expires_at as integer) > ${now}
                `
              : null
          const sessionExists = session
            ? sql`exists (select 1 from ${oauthSession} where ${session})`
            : sql`1`
          let update: SQL
          if (change.kind === 'mint') {
            const providerState =
              change.missingOAuthScopes.length > 0
                ? JSON.stringify({
                    missingOAuthScopes: change.missingOAuthScopes,
                  })
                : null
            if (change.expected) {
              update = sql`
                update ${connection}
                set template = ${change.template}, item_ids = cast(${nextItemIds} as blob),
                  identity_label = coalesce(${change.identityLabel},
                    case when trim(identity_label) <> '' then identity_label end,
                    ${change.derivedIdentityLabel}),
                  oauth_client = ${change.oauthClient}, oauth_client_owner = ${change.oauthClientOwner},
                  refresh_item_id = ${next.refreshItemId}, expires_at = cast(${expiry} as blob),
                  oauth_scope = ${oauthScope}, oauth_token_url = null,
                  provider_state = cast(${providerState} as blob), last_health = null, updated_at = ${updatedAt}
                where ${generation(key, change.expected)} and ${sessionExists}
              `
            } else {
              update = sql`
                insert into ${connection} (
                  row_id, tenant, owner, subject, integration, name, template, provider,
                  item_ids, identity_label, oauth_client, oauth_client_owner, refresh_item_id,
                  expires_at, oauth_scope, provider_state, created_at, updated_at
                )
                select ${crypto.randomUUID()}, ${key.tenant}, ${key.owner}, ${key.subject}, ${key.integration},
                  ${key.name}, ${change.template}, ${next.provider}, cast(${nextItemIds} as blob),
                  ${change.identityLabel ?? change.derivedIdentityLabel}, ${change.oauthClient},
                  ${change.oauthClientOwner}, ${next.refreshItemId}, cast(${expiry} as blob),
                  ${oauthScope}, cast(${providerState} as blob), ${updatedAt}, ${updatedAt}
                where not ${exists(sql`${scope(key)} and name = ${key.name}`)} and ${sessionExists}
              `
            }
          } else {
            update = sql`
              update ${connection}
              set item_ids = cast(${nextItemIds} as blob), refresh_item_id = ${next.refreshItemId},
                expires_at = cast(${expiry} as blob), oauth_scope = coalesce(${oauthScope}, oauth_scope),
                provider_state = cast(json_remove(cast(provider_state as text),
                  '$.oauthReauthRequiredAt', '$.oauthReauthRequiredDetail') as blob),
                last_health = case when json_extract(cast(last_health as text), '$.status') = 'expired'
                  then null else last_health end,
                updated_at = ${updatedAt}
              where ${generation(key, change.expected)}
            `
          }
          // The first statement decides the CAS. Fresh credential IDs plus changes()
          // bind each subsequent statement to that winning write in this batch.
          const won = sql`changes() = 1 and ${exists(generation(key, next))}`
          const insertCredential = (itemId: string, ciphertext: string) =>
            sql`
              insert into ${pluginStorage} (
                row_id, tenant, owner, subject, plugin_id, collection, key, data, created_at, updated_at
              )
              select ${crypto.randomUUID()}, ${key.tenant}, ${key.owner}, ${key.subject},
                'encryptedSecrets', 'secrets', ${itemId}, cast(${JSON.stringify(ciphertext)} as blob),
                ${updatedAt}, ${updatedAt} where ${won}
            `
          const statements = [
            update,
            insertCredential(next.accessItemId, accessCiphertext),
            insertCredential(next.refreshItemId, refreshCiphertext),
          ]
          if (session)
            statements.push(
              sql`delete from ${oauthSession} where ${session} and ${won}`,
            )
          if (change.expected)
            statements.push(deleteCredentials(key, change.expected, won))
          const [changed] = await batch(statements)
          return changed?.meta.changes === 1
        },
        catch: (cause) =>
          new StorageError({
            message: 'Could not save Workstream authorization',
            cause,
          }),
      }),
    remove: (key, expected) =>
      Effect.tryPromise({
        try: async () => {
          const grant = generation(key, expected)
          const current = exists(grant)
          const catalogue = sql`${scope(key)} and connection = ${key.name} and ${current}`
          const [, , , removed] = await batch([
            deleteCredentials(key, expected, current),
            sql`delete from ${tool} where ${catalogue}`,
            sql`delete from ${definition} where ${catalogue}`,
            sql`delete from ${connection} where ${grant}`,
          ])
          return removed?.meta.changes === 1
        },
        catch: (cause) =>
          new StorageError({ message: 'Executor disconnect failed', cause }),
      }),
  }
}

/**
 * Opens Executor's SDK-owned table set over Garden's D1 binding. The table set
 * comes from `createExecutor`, so plugin schema changes cannot drift from the
 * runtime that reads them.
 */
export function createD1ExecutorDb(
  database: D1Database,
  tables: FumaTables,
  blobs?: R2Bucket,
): Effect.Effect<D1ExecutorDb, StorageError> {
  return Effect.tryPromise({
    try: async () => {
      const { connection, tool, definition, plugin_storage, oauth_session } =
        tables
      if (
        connection === undefined ||
        tool === undefined ||
        definition === undefined ||
        plugin_storage === undefined ||
        oauth_session === undefined
      ) {
        throw new Error('Executor connection tables are missing')
      }
      const options = {
        tables,
        namespace: DB_NAMESPACE,
        version: DB_SCHEMA_VERSION,
        provider: 'sqlite' as const,
      }
      const schema = createDrizzleRuntimeSchemaFromTables(options)
      const drizzleDb = drizzle(database, { schema })
      await ensureDrizzleRuntimeSchemaFromTables(
        { run: (query) => drizzleDb.run(query) },
        options,
      )
      const { db } = createExecutorFumaDb(drizzleDb, {
        ...options,
        interactiveTransactions: false,
        maxBoundParameters: 100,
      })
      return {
        db,
        workstreamOAuthStorage: workstreamOAuthStorage(database, {
          connection: connection.names.sql,
          tool: tool.names.sql,
          definition: definition.names.sql,
          pluginStorage: plugin_storage.names.sql,
          oauthSession: oauth_session.names.sql,
        }),
        close: async () => {},
        ...(blobs === undefined ? {} : { blobs: makeR2BlobStore(blobs) }),
      }
    },
    catch: (cause) =>
      new StorageError({ message: 'Executor D1 initialization failed', cause }),
  }).pipe(Effect.withSpan('ExecutorD1.open'))
}
