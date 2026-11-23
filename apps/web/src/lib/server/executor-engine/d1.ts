// Adapted from Executor v1.5.40 apps/host-cloudflare/src/db/d1.ts (MIT).
import { Effect } from 'effect'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core'
import {
  createDrizzleRuntimeSchemaFromTables,
  ensureDrizzleRuntimeSchemaFromTables,
} from '@executor-js/fumadb/adapters/drizzle'
import {
  StorageError,
  type ExecutorDb,
  type FumaTables,
} from '@executor-js/sdk/core'
import { createExecutorFumaDb } from '@executor-js/sdk/host-internal'

import { makeR2BlobStore } from './r2'

const DB_NAMESPACE = 'garden-executor-connectors'
const DB_SCHEMA_VERSION = '1.0.0'

/**
 * Opens Executor's SDK-owned table set over Garden's D1 binding. The table set
 * comes from `createExecutor`, so plugin schema changes cannot drift from the
 * runtime that reads them.
 */
export const createD1ExecutorDb = Effect.fn('ExecutorD1.open')(function* (
  database: D1Database,
  tables: FumaTables,
  blobs?: R2Bucket,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const { connection, tool, definition } = tables
      if (
        connection === undefined ||
        tool === undefined ||
        definition === undefined
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
      const connectionTable = sql.identifier(connection.names.sql)
      const toolTable = sql.identifier(tool.names.sql)
      const definitionTable = sql.identifier(definition.names.sql)
      const dialect = new SQLiteAsyncDialect()
      const removeOAuthConnectionGeneration: NonNullable<
        ExecutorDb['removeOAuthConnectionGeneration']
      > = ({ tenant, owner, subject, integration, name, refreshItemId }) =>
        Effect.tryPromise({
          try: async () => {
            const scope = sql`tenant = ${tenant} and owner = ${owner} and subject = ${subject} and integration = ${integration}`
            const grant = sql`${scope} and name = ${name} and refresh_item_id is ${refreshItemId}`
            const catalogue = sql`${scope} and connection = ${name} and exists (select 1 from ${connectionTable} where ${grant})`
            // D1 batches are atomic. The grant must remain present until both catalogue deletes run.
            const statements = [
              sql`delete from ${toolTable} where ${catalogue}`,
              sql`delete from ${definitionTable} where ${catalogue}`,
              sql`delete from ${connectionTable} where ${grant}`,
            ].map((statement) => {
              const query = dialect.sqlToQuery(statement)
              return database.prepare(query.sql).bind(...query.params)
            })
            const [, , removed] = await database.batch(statements)
            return removed?.meta.changes === 1
          },
          catch: (cause) =>
            new StorageError({ message: 'Executor disconnect failed', cause }),
        })
      return {
        db,
        removeOAuthConnectionGeneration,
        close: async () => {},
        ...(blobs === undefined ? {} : { blobs: makeR2BlobStore(blobs) }),
      }
    },
    catch: (cause) =>
      new StorageError({ message: 'Executor D1 initialization failed', cause }),
  })
})
