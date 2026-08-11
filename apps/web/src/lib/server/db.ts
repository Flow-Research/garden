import type { GardenDatabase } from '@garden/db'
import {
  createDb as createRuntimeDb,
  createDirectRuntimeDbClient,
  createRuntimeDbClient,
  getDirectPooledDb,
  schema,
  type RuntimeDbClient,
} from '@garden/db/runtime'
import type { AppEnv } from '@/lib/server/env'
import { Result } from 'better-result'

/** Creates a Garden database client from the Worker runtime binding. */
export async function getDb(
  env: Pick<AppEnv, 'HYPERDRIVE' | 'DATABASE_URL' | 'ENVIRONMENT'>,
) {
  if (env.ENVIRONMENT === 'development') {
    return getDirectPooledDb(env.DATABASE_URL)
  }

  return await createRuntimeDb(env.HYPERDRIVE)
}

export type Db = GardenDatabase
export type DbProvider = () => Promise<Db>
export type RequestDbProvider = {
  readonly db: DbProvider
  readonly close: () => Promise<void>
}

/**
 * Creates one lazy request-scoped DB client and closes it after TanStack Start
 * finishes the request. Auth and route logic often request the same database;
 * sharing within that request avoids a Neon/Hyperdrive connection storm while
 * still preventing cross-request client reuse.
 */
export function createRequestDbProvider(
  env: Pick<AppEnv, 'HYPERDRIVE' | 'DATABASE_URL' | 'ENVIRONMENT'>,
): RequestDbProvider {
  let clientPromise: Promise<RuntimeDbClient> | undefined
  let closed = false

  return {
    db: async () => {
      if (closed) {
        throw new Error(
          'Cannot create DB client after request DB provider closed',
        )
      }

      clientPromise ??=
        env.ENVIRONMENT === 'development'
          ? createDirectRuntimeDbClient(env.DATABASE_URL)
          : createRuntimeDbClient(env.HYPERDRIVE)
      return (await clientPromise).db
    },
    close: async () => {
      if (closed) return
      closed = true

      const pendingClient = clientPromise
      if (!pendingClient) return

      const clientResult = await Result.tryPromise({
        try: async () => await pendingClient,
        catch: (cause) => cause,
      })
      if (clientResult.isErr()) return

      await Result.tryPromise({
        try: async () => await clientResult.value.close(),
        catch: (cause) => cause,
      })
    },
  }
}

export { schema }
