import { and, desc, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getConnectorById } from '@garden/connectors'
import {
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'

export const Route = createFileRoute('/api/connections/$connectorId/activity')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const connector = getConnectorById(params.connectorId)
        if (!connector) return notFound('Connector not found')

        const db = getDb(appEnv)
        const activity = await db
          .select({
            id: schema.toolCallAudit.id,
            toolCallId: schema.toolCallAudit.toolCallId,
            toolName: schema.capability.name,
            resultStatus: schema.toolCallAudit.resultStatus,
            durationMs: schema.toolCallAudit.durationMs,
            timestamp: schema.toolCallAudit.ts,
            error: schema.toolCallAudit.error,
            agentId: schema.agent.id,
            agentName: schema.agent.name,
          })
          .from(schema.toolCallAudit)
          .innerJoin(
            schema.capability,
            eq(schema.toolCallAudit.capabilityId, schema.capability.id),
          )
          .innerJoin(schema.agent, eq(schema.toolCallAudit.agentId, schema.agent.id))
          .where(
            and(
              eq(schema.toolCallAudit.workspaceId, workspaceId),
              eq(schema.capability.connectorType, connector.id),
            ),
          )
          .orderBy(desc(schema.toolCallAudit.ts))
          .limit(50)

        return Response.json({
          connectorId: connector.id,
          activity: activity.map((entry) => ({
            id: entry.id,
            toolCallId: entry.toolCallId,
            toolName: entry.toolName,
            resultStatus: entry.resultStatus,
            durationMs: entry.durationMs,
            timestamp: entry.timestamp,
            error: entry.error,
            agent: {
              id: entry.agentId,
              name: entry.agentName,
            },
          })),
        })
      },
    },
  },
})
