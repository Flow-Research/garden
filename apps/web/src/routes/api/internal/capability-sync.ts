import { Effect, Result, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { syncCapabilities } from '@/lib/server/capability-sync'
import { appEnv } from '@/lib/server/env'
import { captureApiFailure, logApiFailure } from '@/lib/server/api-logging'

const CapabilitySyncBody = Schema.Struct({
  connectorId: Schema.String,
  userId: Schema.String,
  workspaceId: Schema.String,
})

async function sha256(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
}

/**
 * Compares digests rather than the raw strings so the check takes the same time
 * whatever the header holds. An unset secret (wrangler defaults secrets to "")
 * never authorizes.
 */
async function isAuthorized(request: Request) {
  const expected = appEnv.BETTER_AUTH_SECRET
  const provided = request.headers.get('x-garden-internal-secret')
  if (!expected || !provided) return false

  const [expectedDigest, providedDigest] = await Promise.all([
    sha256(expected),
    sha256(provided),
  ])
  let difference = 0
  expectedDigest.forEach((byte, index) => {
    difference |= byte ^ (providedDigest.at(index) ?? 0)
  })
  return difference === 0
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
        if (!(await isAuthorized(request))) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const rawBody = await request.text()
        const bodyResult = await Effect.runPromise(
          Effect.result(
            Schema.decodeUnknownEffect(
              Schema.fromJsonString(CapabilitySyncBody),
            )(rawBody),
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
          const status = capabilitySyncErrorStatus(error.code)
          if (status >= 500) {
            await captureApiFailure({
              request,
              event: 'connector.capability_sync.failed',
              error,
            })
          } else {
            logApiFailure({
              request,
              event: 'connector.capability_sync.rejected',
              error,
              level: 'warn',
            })
          }
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
