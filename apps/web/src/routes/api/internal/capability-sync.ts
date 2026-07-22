import { Effect, Result, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { syncCapabilities } from '@/lib/server/capability-sync'
import { appEnv } from '@/lib/server/env'

const CapabilitySyncBody = Schema.Struct({
  connectorId: Schema.String,
  userId: Schema.String,
  workspaceId: Schema.String,
})

function isAuthorized(request: Request) {
  return (
    request.headers.get('x-garden-internal-secret') ===
    appEnv.BETTER_AUTH_SECRET
  )
}

const capabilitySyncErrorStatus = (code: string) => {
  switch (code) {
    case 'connector_not_found':
      return 404
    case 'sync_agent_not_found':
    case 'unclassified_tool':
      return 409
    default:
      return 500
  }
}

export const Route = createFileRoute('/api/internal/capability-sync')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const rawBody = await request.text()
        const bodyResult = await Effect.runPromise(
          Effect.result(
            Effect.try({
              try: () => JSON.parse(rawBody),
              catch: () => new Error('invalid-capability-sync-json'),
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(CapabilitySyncBody)),
            ),
          ),
        )
        if (Result.isFailure(bodyResult)) {
          return Response.json(
            { error: 'connectorId, userId, and workspaceId are required' },
            { status: 400 },
          )
        }

        const syncResult = await Effect.runPromise(
          Effect.result(
            syncCapabilities(
              bodyResult.success.connectorId,
              bodyResult.success.userId,
              bodyResult.success.workspaceId,
            ),
          ),
        )
        if (Result.isFailure(syncResult)) {
          const error = syncResult.failure
          return Response.json(
            { error: error.message, code: error.code },
            { status: capabilitySyncErrorStatus(error.code) },
          )
        }

        return Response.json({ ok: true })
      },
    },
  },
})
