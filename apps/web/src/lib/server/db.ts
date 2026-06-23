import type { GardenDatabase } from '@garden/db'
import {
  createDb as createRuntimeDb,
  createRuntimeDbClient,
  schema,
  type RuntimeDbClient,
} from '@garden/db/runtime'
import type { AppEnv } from '@/lib/server/env'
import { Result } from 'better-result'

/** Creates a Garden database client from the Worker runtime binding. */
export async function getDb(env: Pick<AppEnv, 'HYPERDRIVE'>) {
  return await createRuntimeDb(env.HYPERDRIVE)
}

export type Db = GardenDatabase
export type DbProvider = () => Promise<Db>
export type RequestDbProvider = {
  readonly db: DbProvider
  readonly close: () => Promise<void>
}

/**
 * Creates a request-scoped DB provider that tracks every raw pg client and
 * closes them after TanStack Start finishes the request. Garden previously
 * memoized one client and never closed it; in Cloudflare local dev that left the
 * Hyperdrive proxy socket alive long enough for DNS/socket failures to surface as
 * unhandled Node events and kill localhost. This mirrors VCOS's explicit pg
 * lifecycle while keeping production Hyperdrive as the connection source.
 */
export function createRequestDbProvider(
  env: Pick<AppEnv, 'HYPERDRIVE'>,
): RequestDbProvider {
  const clients = new Set<RuntimeDbClient>()
  let closed = false

  return {
    db: async () => {
      if (closed) {
        throw new Error(
          'Cannot create DB client after request DB provider closed',
        )
      }

      const client = await createRuntimeDbClient(env.HYPERDRIVE)
      clients.add(client)
      return client.db
    },
    close: async () => {
      if (closed) return
      closed = true

      const pending = Array.from(clients)
      clients.clear()
      await Promise.all(
        pending.map(async (client) => {
          await Result.tryPromise({
            try: async () => await client.close(),
            catch: (cause) => cause,
          })
        }),
      )
    },
  }
}

export { schema }
