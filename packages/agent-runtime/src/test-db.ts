import { Pool } from 'pg'
import { Result } from 'better-result'

export async function isTestDbReachable(
  connectionString: string,
  timeoutMillis = 2000,
): Promise<boolean> {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: timeoutMillis,
  })
  return Result.tryPromise({
    try: async () => {
      await pool.query('SELECT 1')
      return true
    },
    catch: () => false,
  })
    .then((result) => result.unwrapOr(false))
    .finally(() => pool.end().catch(() => undefined))
}
