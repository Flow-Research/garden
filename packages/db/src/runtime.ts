import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import type { GardenDatabase } from './client.js'
import * as schema from './schema/index.js'

export type Db = GardenDatabase
export type DatabaseConnection = { readonly connectionString: string }
export type RuntimeDbClient = {
  readonly db: Db
  readonly close: () => Promise<void>
}

/**
 * Opens one explicit pg client for request/invocation-scoped work. VCOS uses the
 * same raw pg lifecycle pattern instead of relying on a long-lived local
 * Hyperdrive emulation socket; Garden needs that in dev because Cloudflare's
 * local proxy can surface DNS/socket failures as async `error` events. The
 * listener prevents an orphaned client error from crashing Node, and callers
 * must close the returned client once the request has finished.
 */
export async function createRuntimeDbClient(
  connection: DatabaseConnection | null | undefined,
): Promise<RuntimeDbClient> {
  const connectionString = connection?.connectionString
  if (!connectionString) {
    throw new Error('Missing database connection string')
  }

  const client = new Client({ connectionString })
  client.on('error', () => {})
  await client.connect()

  return {
    db: drizzle(client, { schema }),
    close: async () => {
      await client.end()
    },
  }
}

/** Creates a Garden database client for one-off callers that own the invocation. */
export async function createDb(
  connection: DatabaseConnection | null | undefined,
): Promise<Db> {
  return (await createRuntimeDbClient(connection)).db
}

export { schema }
