import { createFileRoute } from '@tanstack/react-router'
import { matchError } from 'better-result'
import { z } from 'zod'
import { getConnectorById } from '@garden/connectors'
import type { ConnectorId } from '@garden/connectors/registry'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import { getDb } from '@/lib/server/db'
import { getConnectorCallbackEventByFlow } from '@/lib/server/connector-callback-events'
import { parseSearchParams } from '@/lib/server/validation/common'

const connectorCallbackEventQuerySchema = z.object({
  flow_id: z.string().trim().min(1),
  connector_id: z.string().trim().min(1).optional(),
})

export const Route = createFileRoute('/api/connections/callback-events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await requireWorkspaceContext(request)
        if (context instanceof Response) return context

        const query = parseSearchParams(
          request,
          connectorCallbackEventQuerySchema,
          'Invalid connector callback event query',
        )
        if (query.isErr()) return badRequest(query.error.message)

        const connectorId = query.value.connector_id
        if (connectorId && !getConnectorById(connectorId)) {
          return badRequest('Unknown connector')
        }

        const event = await getConnectorCallbackEventByFlow({
          db: getDb(appEnv),
          workspaceId: context.workspaceId,
          flowId: query.value.flow_id,
          connectorId: connectorId ? (connectorId as ConnectorId) : null,
        })

        return event.match({
          ok: (callbackEvent) => Response.json({ event: callbackEvent }),
          err: (error) =>
            matchError(error, {
              ConnectorCallbackDatabaseError: (databaseError) =>
                Response.json(
                  { error: databaseError.message },
                  { status: 500 },
                ),
              ConnectorCallbackEventNotFound: (missingEvent) =>
                notFound(missingEvent.message),
            }),
        })
      },
    },
  },
})
