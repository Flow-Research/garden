import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { getConnectorById } from '@garden/connectors'
import {
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { getConnectorActivityFeed } from '@/lib/server/connections/activity-service'

/**
 * Connector activity feed. Session + workspace resolve stay here; feed
 * assembly lives in activity-service / queries/connections.
 */
export const Route = createFileRoute('/api/connections/$connectorId/activity')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const connector = getConnectorById(params.connectorId)
        if (!connector) return notFound('Connector not found')

        const feed = await getConnectorActivityFeed({
          db: await appContext.db(),
          workspaceId,
          connectorId: connector.id,
        })
        return Response.json(feed)
      },
    },
  },
})
