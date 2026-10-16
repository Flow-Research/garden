import { Effect, Result, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { executorCatalogSchema } from '@garden/core/executor/catalog'
import { appEnv } from '@/lib/server/env'
import { loadExecutorCatalog } from '@/lib/server/executor-runtime'

const ExecutorCatalogRequest = Schema.Struct({
  userId: Schema.String,
  workspaceId: Schema.String,
})

function isAuthorized(request: Request) {
  return (
    request.headers.get('x-garden-internal-secret') ===
    appEnv.BETTER_AUTH_SECRET
  )
}

/**
 * Exposes the request-scoped Executor catalog to the Chat Durable Object.
 * Chat cannot open the app's D1 Executor binding directly, so this internal
 * route keeps the catalog lookup inside the web Worker while preserving the
 * current workspace and user identity. The shared MCP session uses the same
 * identity boundary.
 */
export const Route = createFileRoute('/api/internal/executor/catalog')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const rawBody = await request.text()
        const bodyResult = await Effect.runPromise(
          Effect.result(
            Schema.decodeUnknownEffect(
              Schema.fromJsonString(ExecutorCatalogRequest),
            )(rawBody),
          ),
        )
        if (Result.isFailure(bodyResult)) {
          return Response.json(
            { error: 'userId and workspaceId are required' },
            { status: 400 },
          )
        }

        const catalogResult = await Effect.runPromise(
          Effect.result(
            loadExecutorCatalog({
              tenant: bodyResult.success.workspaceId,
              subject: bodyResult.success.userId,
            }),
          ),
        )
        if (Result.isFailure(catalogResult)) {
          return Response.json(
            { error: 'Executor catalog is unavailable' },
            { status: 502 },
          )
        }

        const catalog = catalogResult.success
        const responsePayload = {
          integrations: catalog.integrations.map((integration) => ({
            slug: integration.slug,
            name: integration.name,
            description: integration.description,
          })),
          connections: catalog.connections.map((connection) => ({
            owner: connection.owner,
            integration: connection.integration,
            name: connection.name,
            identityLabel: connection.identityLabel,
          })),
          tools: catalog.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            integration: tool.integration,
            connection: tool.connection,
            owner: tool.owner,
            requiresApproval: tool.requiresApproval,
          })),
        }
        return Response.json(executorCatalogSchema.parse(responsePayload))
      },
    },
  },
})
