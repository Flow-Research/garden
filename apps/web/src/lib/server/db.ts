import type { GardenDatabase } from '@garden/db'
import { createDb as createRuntimeDb, schema } from '@garden/db/runtime'
import type { AppEnv } from '@/lib/server/env'

/** Creates a Garden database client from the Worker runtime binding. */
export async function getDb(env: Pick<AppEnv, 'HYPERDRIVE'>) {
  return await createRuntimeDb(env.HYPERDRIVE)
}

export type Db = GardenDatabase
export type DbProvider = () => Promise<Db>

/** Creates a memoized request-scoped DB provider for TanStack Start context. */
export function createDbProvider(env: Pick<AppEnv, 'HYPERDRIVE'>): DbProvider {
  let db: Promise<Db> | undefined
  return () => {
    if (!db) db = getDb(env)
    return db
  }
}

export { schema }
