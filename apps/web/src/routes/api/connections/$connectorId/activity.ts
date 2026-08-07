import { and, desc, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { getConnectorById } from '@garden/connectors'
import {
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'

export const Route = createFileRoute('/api/connections/$connectorId/activity')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const connector = getConnectorById(params.connectorId)
        if (!connector) return notFound('Connector not found')

        const db = await appContext.db()
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
          .innerJoin(
            schema.agent,
            eq(schema.toolCallAudit.agentId, schema.agent.id),
          )
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
