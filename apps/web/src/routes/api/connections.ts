import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { buildConnectionSurface } from '@/lib/server/workspace-surfaces'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/connections')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return Response.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const db = getDb(appEnv)
        const [connections, capabilities, permissionGrants, invocationLogs, agents] =
          await Promise.all([
            db
              .select()
              .from(schema.connectorConnection)
              .where(eq(schema.connectorConnection.workspaceId, workspaceId)),
            db.select().from(schema.capability),
            db.select().from(schema.permissionGrant),
            db.select().from(schema.invocationLog),
            db.select().from(schema.agent).where(eq(schema.agent.workspaceId, workspaceId)),
          ])

        const connectors = buildConnectionSurface({
          connections,
          capabilities,
          permissionGrants,
          invocationLogs,
        })

        return Response.json({
          summary: {
            connectorCount: connectors.length,
            connectedCount: connectors.filter(
              (connector) => connector.status === 'connected',
            ).length,
            toolCount: connectors.reduce(
              (total, connector) => total + connector.toolCount,
              0,
            ),
            recentInvocations: connectors.reduce(
              (total, connector) => total + connector.recentInvocations,
              0,
            ),
            agentCount: agents.length,
          },
          agents: agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            status: agent.status,
          })),
          connectors,
        })
      },
    },
  },
})
