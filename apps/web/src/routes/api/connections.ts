import { Effect, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { ExecutorConnectionsSnapshot } from '@/lib/executor-contract'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import { buildConnectionsSnapshot } from '@/lib/server/connections/list-service'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'

class ExecutorConnectionsRouteError extends Schema.Error<ExecutorConnectionsRouteError>(
  'ExecutorConnectionsRouteError',
)({
  status: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * GET /api/connections — auth + HTTP map only. Snapshot assembly lives in
 * `buildConnectionsSnapshot` (list-service) so this route has no db/drizzle
 * imports. Docs: docs/decisions/2026-11-09-api-layering.md.
 */
export const Route = createFileRoute('/api/connections')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const db = await appContext.db()
        const outcome = await runExecutorRouteEffect({
          effect: Effect.mapError(
            buildConnectionsSnapshot(
              {
                tenant: workspaceContext.workspaceId,
                subject: workspaceContext.session.user.id,
              },
              db,
            ),
            (cause) =>
              new ExecutorConnectionsRouteError({
                status: 502,
                message: 'Connections could not be loaded.',
                cause,
              }),
          ),
          request: appContext.request,
          event: 'executor.connections.failed',
          fallbackMessage: 'Connections could not be loaded.',
        })
        if (!outcome.ok) return outcome.response
        return Response.json(
          Schema.encodeSync(ExecutorConnectionsSnapshot)(outcome.value),
        )
      },
    },
  },
})
