import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { toAgent } from '@/lib/server/control-plane'
import type { Db } from '@/lib/server/db'
import { getAgentById } from '@/lib/server/queries/agents'

export class AgentGetError extends TaggedError('AgentGetError')<{
  message: string
  status: number
}>() {}

/**
 * Loads one agent by id. Route still runs `requireWorkspaceAccess` on
 * `workspaceId` after a successful load (same order as before).
 */
export async function getAgentRecord(
  db: Db,
  agentId: string,
): Promise<
  ResultValue<
    { agent: ReturnType<typeof toAgent>; workspaceId: string },
    AgentGetError
  >
> {
  const row = await getAgentById(db, agentId)
  if (!row) {
    return Result.err(
      new AgentGetError({
        message: 'Agent not found',
        status: 404,
      }),
    )
  }
  return Result.ok({
    agent: toAgent(row),
    workspaceId: row.workspaceId,
  })
}
