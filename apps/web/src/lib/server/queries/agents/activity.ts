import { and, desc, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Agent activity feed sources (tool decisions + grant activity events).
 * Before: inline in `routes/api/agents/$id/activity.ts`. After: queries only.
 */
export async function listAgentToolDecisions(
  db: Db,
  input: { workspaceId: string; agentId: string; limit?: number },
) {
  const limit = input.limit ?? 50
  return await db
    .select({
      id: schema.toolCallAudit.id,
      toolCallId: schema.toolCallAudit.toolCallId,
      toolName: schema.capability.name,
      connectorId: schema.capability.connectorType,
      resultStatus: schema.toolCallAudit.resultStatus,
      error: schema.toolCallAudit.error,
      timestamp: schema.toolCallAudit.ts,
    })
    .from(schema.toolCallAudit)
    .innerJoin(
      schema.capability,
      eq(schema.toolCallAudit.capabilityId, schema.capability.id),
    )
    .where(
      and(
        eq(schema.toolCallAudit.workspaceId, input.workspaceId),
        eq(schema.toolCallAudit.agentId, input.agentId),
      ),
    )
    .orderBy(desc(schema.toolCallAudit.ts))
    .limit(limit)
}

export async function listAgentGrantActivity(
  db: Db,
  input: { workspaceId: string; agentId: string; limit?: number },
) {
  const limit = input.limit ?? 50
  return await db
    .select({
      id: schema.activityEvent.id,
      eventType: schema.activityEvent.eventType,
      payload: schema.activityEvent.payload,
      timestamp: schema.activityEvent.createdAt,
    })
    .from(schema.activityEvent)
    .where(
      and(
        eq(schema.activityEvent.workspaceId, input.workspaceId),
        eq(schema.activityEvent.subjectType, 'agent'),
        eq(schema.activityEvent.subjectId, input.agentId),
      ),
    )
    .orderBy(desc(schema.activityEvent.createdAt))
    .limit(limit)
}
