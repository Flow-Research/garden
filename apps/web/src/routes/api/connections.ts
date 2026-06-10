import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { listAvailableConnectorBindings } from '@garden/server/connectors/availability'
import { buildConnectionSurface } from '@/lib/server/connection-surface'
import { requireWorkspaceContext } from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/connections')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await requireWorkspaceContext(request)
        if (context instanceof Response) return context
        const { workspaceId } = context

        const db = getDb(appEnv)
        const summaryOnly = new URL(request.url).searchParams.get('summary') === '1'
        const agents = await db
          .select()
          .from(schema.agent)
          .where(eq(schema.agent.workspaceId, workspaceId))
        const agentIds = agents.map((agent) => agent.id)

        if (summaryOnly) {
          const [connections, availableConnectors] = await Promise.all([
            db
              .select()
              .from(schema.account)
              .where(
                and(
                  eq(schema.account.workspaceId, workspaceId),
                  isNotNull(schema.account.connectorType),
                ),
              ),
            listAvailableConnectorBindings({
              db,
              getEnvVar: (name) => {
                const value = (appEnv as Record<string, unknown>)[name]
                return typeof value === 'string' ? value : undefined
              },
              userId: context.session.user.id,
              workspaceId,
            }),
          ])

          const connectors = buildConnectionSurface({
            agentIds,
            connections,
            availableConnectors,
            capabilities: [],
            permissionGrants: [],
            toolCallAudits: [],
          })

          return Response.json({
            summary: {
              connectorCount: connectors.length,
              connectedCount: connectors.filter(
                (connector) => connector.status === 'connected',
              ).length,
              toolCount: 0,
              recentInvocations: 0,
              agentCount: agents.length,
            },
            agents: agents.map((agent) => ({
              id: agent.id,
              name: agent.name,
              status: agent.status,
            })),
            connectors,
          })
        }

        const [
          connections,
          availableConnectors,
          capabilities,
          permissionGrants,
          toolCallAudits,
        ] = await Promise.all([
            db
              .select()
              .from(schema.account)
              .where(
                and(
                  eq(schema.account.workspaceId, workspaceId),
                  isNotNull(schema.account.connectorType),
                ),
              ),
            listAvailableConnectorBindings({
              db,
              getEnvVar: (name) => {
                const value = (appEnv as Record<string, unknown>)[name]
                return typeof value === 'string' ? value : undefined
              },
              userId: context.session.user.id,
              workspaceId,
            }),
            db.select().from(schema.capability),
            agentIds.length > 0
              ? db
                  .select()
                  .from(schema.permissionGrant)
                  .where(inArray(schema.permissionGrant.agentId, agentIds))
              : Promise.resolve(
                  [] as Array<typeof schema.permissionGrant.$inferSelect>,
                ),
            db
              .select()
              .from(schema.toolCallAudit)
              .where(eq(schema.toolCallAudit.workspaceId, workspaceId))
              .orderBy(desc(schema.toolCallAudit.ts))
              .limit(500),
          ])

        const connectors = buildConnectionSurface({
          agentIds,
          connections,
          availableConnectors,
          capabilities,
          permissionGrants,
          toolCallAudits,
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
