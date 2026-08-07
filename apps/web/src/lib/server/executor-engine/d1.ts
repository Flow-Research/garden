// Adapted from Executor v1.5.40 apps/host-cloudflare/src/db/d1.ts (MIT).
import { Effect } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import {
  createDrizzleRuntimeSchemaFromTables,
  ensureDrizzleRuntimeSchemaFromTables,
} from '@executor-js/fumadb/adapters/drizzle'
import { StorageError, type FumaTables } from '@executor-js/sdk/core'
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
        close: async () => {},
        ...(blobs === undefined ? {} : { blobs: makeR2BlobStore(blobs) }),
      }
    },
    catch: (cause) =>
      new StorageError({ message: 'Executor D1 initialization failed', cause }),
  })
})
