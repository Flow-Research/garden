import type { Db } from '@/lib/server/db'
import { listConnectorToolActivity } from '@/lib/server/queries/connections'

/** Builds the connector activity feed DTO for the activity route. */
export async function getConnectorActivityFeed(input: {
  db: Db
  workspaceId: string
  connectorId: string
}) {
  const activity = await listConnectorToolActivity(input.db, {
    workspaceId: input.workspaceId,
    connectorId: input.connectorId,
  })
  return {
    connectorId: input.connectorId,
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
  }
}
