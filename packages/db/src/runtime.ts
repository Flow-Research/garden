import { drizzle } from 'drizzle-orm/node-postgres'
import { Effect, Schedule, Schema } from 'effect'
import { Client, Pool } from 'pg'
import type { GardenDatabase } from './client.js'
import * as schema from './schema/index.js'

export type Db = GardenDatabase
export type DatabaseConnection = { readonly connectionString: string }
export type RuntimeDbClient = {
  readonly db: Db
  readonly close: () => Promise<void>
}

const CONNECTION_TIMEOUT_MS = 5_000
const SHORT_LIVED_POOL_IDLE_TIMEOUT_MS = 250

/** Explicit Hyperdrive acquisition failure for Effect callers and adapters. */
export class DatabaseConnectionError extends Schema.TaggedErrorClass<DatabaseConnectionError>()(
  'DatabaseConnectionError',
  {
    operation: Schema.Literal('connect'),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * A failed connection has not run application SQL, so acquisition can safely
 * retry. Two jittered retries keep transient DNS/tunnel loss recoverable while
 * the driver's measured five-second connection timeout keeps failure bounded.
 */
export const runtimeDbConnectRetrySchedule = Schedule.exponential(
  '100 millis',
).pipe(Schedule.jittered, Schedule.upTo({ times: 2 }))

/**
 * Creates the only pool shape allowed for Promise-only callers that cannot own
 * an Effect Scope. The 250 ms idle window lets a small query burst reuse one
 * socket, then closes it instead of leaking pools across Worker requests. An
 * idle error listener is mandatory because node-postgres otherwise promotes a
 * transient tunnel error to an uncaught process exception.
 */
function createShortLivedPool(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: SHORT_LIVED_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    allowExitOnIdle: true,
    application_name: 'garden-worker-promise-adapter',
  })

  pool.on('error', (cause) => {
    console.error('[garden-db] idle PostgreSQL client failed', cause)
  })

  return pool
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
 * This compatibility API intentionally does not cache across invocations.
 * Cloudflare forbids reusing request-created I/O in another request, while the
 * short-lived pool bounds each legacy call site to one socket and retires it
 * immediately after its query burst. New application code should use
 * {@link createRuntimeDbClient} inside Effect `acquireUseRelease`.
 */
export function getPooledDb(connectionString: string): Db {
  return drizzle(createShortLivedPool(connectionString), { schema })
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
  return drizzle(createShortLivedPool(connectionString), { schema })
}

/**
 * Opens one explicit pg client for request/invocation-scoped work. Garden uses
 * this instead of relying on a long-lived local Hyperdrive emulation socket
 * because Cloudflare's local proxy can surface DNS/socket failures as async
 * `error` events. The listener prevents an orphaned client error from crashing
 * Node, and callers must close the client after the request finishes.
 */
export function acquireRuntimeDbClient(
  connection: DatabaseConnection | null | undefined,
): Effect.Effect<RuntimeDbClient, DatabaseConnectionError> {
  const connectionString = connection?.connectionString
  if (!connectionString) {
    return Effect.fail(
      new DatabaseConnectionError({
        operation: 'connect',
        message: 'Missing database connection string',
      }),
    )
  }

  return Effect.gen(function* () {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      application_name: 'garden-worker-request',
    })
    client.on('error', () => {
      // Active queries receive the driver rejection. This listener prevents an
      // idle socket failure from terminating the local Worker process.
    })

    yield* Effect.tryPromise({
      try: () => client.connect(),
      catch: (cause) =>
        new DatabaseConnectionError({
          operation: 'connect',
          message: 'Could not connect to PostgreSQL through Hyperdrive.',
          cause,
        }),
    }).pipe(
      Effect.onError(() =>
        Effect.tryPromise(() => client.end()).pipe(Effect.ignore),
      ),
    )

    return {
      db: drizzle(client, { schema }),
      close: async () => {
        await client.end()
      },
    }
  }).pipe(Effect.retry(runtimeDbConnectRetrySchedule))
}

/** Promise adapter for request boundaries that cannot consume Effect directly. */
export async function createRuntimeDbClient(
  connection: DatabaseConnection | null | undefined,
): Promise<RuntimeDbClient> {
  return await Effect.runPromise(acquireRuntimeDbClient(connection))
}

/**
 * Compatibility adapter for Promise-only one-off callers. Unlike the previous
 * implementation, it does not discard an explicit client's close handle.
 */
export async function createDb(
  connection: DatabaseConnection | null | undefined,
): Promise<Db> {
  const connectionString = connection?.connectionString
  if (!connectionString) {
    throw new DatabaseConnectionError({
      operation: 'connect',
      message: 'Missing database connection string',
    })
  }
  return getPooledDb(connectionString)
}

export { schema }
