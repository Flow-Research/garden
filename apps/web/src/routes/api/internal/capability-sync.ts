import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { syncCapabilities } from '@/lib/server/capability-sync'
import { appEnv } from '@/lib/server/env'

function isAuthorized(request: Request) {
  return (
    request.headers.get('x-garden-internal-secret') ===
    appEnv.BETTER_AUTH_SECRET
  )
}

function parseCapabilitySyncBody(raw: string) {
  return Result.try(() => JSON.parse(raw) as Record<string, unknown>).andThen(
    (body) =>
      typeof body.connectorId === 'string' &&
      typeof body.userId === 'string' &&
      typeof body.workspaceId === 'string'
        ? Result.ok({
            connectorId: body.connectorId,
            userId: body.userId,
            workspaceId: body.workspaceId,
          })
        : Result.err('invalid-capability-sync-body'),
  )
}

export const Route = createFileRoute('/api/internal/capability-sync')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const bodyResult = parseCapabilitySyncBody(await request.text())
        if (bodyResult.isErr()) {
          return Response.json(
            { error: 'connectorId, userId, and workspaceId are required' },
            { status: 400 },
          )
        }

        const syncResult = await syncCapabilities(
          bodyResult.value.connectorId,
          bodyResult.value.userId,
          bodyResult.value.workspaceId,
        )

        if (syncResult.isErr()) {
          const error = syncResult.error
          const status =
            error.code === 'connector_not_found'
              ? 404
              : error.code === 'sync_agent_not_found' ||
                  error.code === 'unclassified_tool'
                ? 409
                : 500
          return Response.json(
            { error: error.message, code: error.code },
            { status },
          )
        }

        return Response.json({ ok: true })
      },
    },
  },
})
