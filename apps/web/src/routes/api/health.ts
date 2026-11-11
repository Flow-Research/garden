import { createFileRoute } from '@tanstack/react-router'
import { Result } from 'better-result'
import { sql } from 'drizzle-orm'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'

const healthLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'health-api',
})

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Public deploy health check (FLO-32).
 *
 * Before: Garden had no health route, so a deploy could only be checked by
 * signing in by hand. After: `GET /api/health` runs one `select 1` through
 * the request db client and answers `200 {status:'ok'}` or
 * `503 {status:'degraded'}`. It needs no session, never puts error text in
 * the body, and logs the failure server-side through the redacting
 * `errorFields` helper.
 *
 * References: `docs/reference/known-gaps.md` (FLO-32), TanStack Start
 * server routes (`@tanstack/start-client-core` start-core skill), and the
 * `/api/inbox` exported-handler pattern used for route tests.
 */
export const getHealth = async ({
  context,
}: {
  context: AppRequestContext
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const dbCheck = await Result.tryPromise({
    try: async () => {
      const db = await appContext.db()
      await db.execute(sql`select 1`)
    },
    catch: (cause) => cause,
  })

  return dbCheck.match({
    ok: () =>
      Response.json(
        { status: 'ok', checks: { database: 'ok' } },
        { headers: NO_STORE },
      ),
    err: (cause) => {
      healthLogger.error('health database check failed', errorFields(cause))
      return Response.json(
        { status: 'degraded', checks: { database: 'error' } },
        { status: 503, headers: NO_STORE },
      )
    },
  })
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: getHealth,
    },
  },
})
