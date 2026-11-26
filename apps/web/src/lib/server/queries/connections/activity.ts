import { and, desc, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/** Lists recent tool-call audit rows for a connector in a workspace. */
export async function listConnectorToolActivity(
  db: Db,
  input: { workspaceId: string; connectorId: string; limit?: number },
) {
  const limit = input.limit ?? 50
  return await db
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
        eq(schema.toolCallAudit.workspaceId, input.workspaceId),
        eq(schema.capability.connectorType, input.connectorId),
      ),
    )
    .orderBy(desc(schema.toolCallAudit.ts))
    .limit(limit)
}
