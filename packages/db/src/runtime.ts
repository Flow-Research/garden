import { drizzle } from 'drizzle-orm/node-postgres'
import { Client, Pool } from 'pg'
import type { GardenDatabase } from './client.js'
import * as schema from './schema/index.js'

export type Db = GardenDatabase
export type DatabaseConnection = { readonly connectionString: string }
export type RuntimeDbClient = {
  readonly db: Db
  readonly close: () => Promise<void>
}

/**
 * Returns a Drizzle client for a Hyperdrive connection string. Callers MUST pass
 * `env.HYPERDRIVE.connectionString`, never the raw Neon `DATABASE_URL`.
 *
 * Why this exists: the agent runtime previously called `drizzle(env.DATABASE_URL)`
 * from `drizzle-orm/neon-serverless` on every operation — a brand-new Neon
 * WebSocket connection per call, straight to the origin, bypassing Hyperdrive and
 * never closed. Those orphaned direct connections defeat database autosuspend
 * and keep origin compute active without useful work.
 *
 * We deliberately do NOT cache/pool connections here. Pooling and closing idle
 * origin connections is Hyperdrive's job (10-minute idle timeout —
 * https://developers.cloudflare.com/hyperdrive/platform/limits/), so once traffic
 * goes through the Hyperdrive binding, Neon can scale to zero again. App-side
 * connection caching across invocations is also a Cloudflare anti-pattern: I/O
 * created in one request cannot be reused by another ("Cannot perform I/O on behalf
 * of a different request" — https://developers.cloudflare.com/workers/observability/errors/).
 * node-postgres' connection-string form creates an invocation-local pool that
 * Hyperdrive fronts; we let the driver and Hyperdrive own the lifecycle.
 *
 * TODO(effect): rewrite the runtime DB layer with Effect. Connection lifecycle
 * here is implicit (we lean on Hyperdrive + the driver to reap). Effect `Scope` /
 * `acquireRelease` would make acquire/close explicit and leak-proof across the
 * agent-runtime call sites, and compose with the rest of the better-result →
 * Effect migration.
 */
export function getPooledDb(connectionString: string): Db {
  return drizzle(connectionString, { schema })
}

/**
 * Same as {@link getPooledDb} but for callers that bind a narrower schema
 * subset. Keeps the node-postgres/`pg` driver dependency inside `@garden/db` so
 * other packages do not import a Postgres driver directly.
 */
export function getPooledDbWith<TSchema extends Record<string, unknown>>(
  connectionString: string,
  schema: TSchema,
) {
  return drizzle(connectionString, { schema })
}

/**
 * Opens one explicit pg client for request/invocation-scoped work. Garden uses
 * this instead of relying on a long-lived local Hyperdrive emulation socket
 * because Cloudflare's local proxy can surface DNS/socket failures as async
 * `error` events. The listener prevents an orphaned client error from crashing
 * Node, and callers must close the client after the request finishes.
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

/**
 * Creates a Garden database client for callers that never close it. It used to
 * open a `Client` and drop the `close()` handle, leaking one connection per call;
 * now it is a single-connection pool that releases the connection after a short
 * idle period, so an abandoned client cleans up after itself. Prefer
 * {@link createRuntimeDbClient} (or a request-scoped provider) and close it.
 */
export async function createDb(
  connection: DatabaseConnection | null | undefined,
): Promise<Db> {
  const connectionString = connection?.connectionString
  if (!connectionString) {
    throw new Error('Missing database connection string')
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  })
  pool.on('error', () => {})
  return drizzle(pool, { schema })
}

export { schema }
