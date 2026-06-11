import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import type { GardenDatabase } from './client.js'
import * as schema from './schema/index.js'

export type Db = GardenDatabase
export type DatabaseConnection = { readonly connectionString: string }

/**
 * Creates a connected Garden database client for one Worker invocation. Local
 * Hyperdrive emulation uses node-postgres directly, and pg emits async `error`
 * events for socket failures; without a listener, dev can crash after a rejected
 * connect/query. The listener keeps failures on the awaited DB operation path.
 */
export async function createDb(
  connection: DatabaseConnection | null | undefined,
): Promise<Db> {
  const connectionString = connection?.connectionString
  if (!connectionString) {
    throw new Error('Missing database connection string')
  }

  const client = new Client({ connectionString })
  client.on('error', () => {})
  await client.connect()
  return drizzle(client, { schema })
}

export { schema }
