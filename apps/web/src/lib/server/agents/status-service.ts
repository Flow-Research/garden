import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { toAgent } from '@/lib/server/control-plane'
import type { Db } from '@/lib/server/db'
import {
  getAgentWorkspaceHost,
  setAgentRowStatus,
} from '@/lib/server/queries/agents'

export class AgentStatusError extends TaggedError('AgentStatusError')<{
  message: string
  status: number
}>() {}

/**
 * Archives or restores an agent row after the route has checked
 * `agentManage`. Before: `setAgentStatus` in `agent-status.ts` returned
 * `Response` and owned the permission check. After: route owns permission;
 * this returns `Result` + DTO. See api-layering ADR.
 */
export async function updateAgentStatus(input: {
  db: Db
  agentId: string
  workspaceId: string
  status: 'active' | 'archived'
}): Promise<ResultValue<ReturnType<typeof toAgent>, AgentStatusError>> {
  const agent = await setAgentRowStatus(input.db, {
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    status: input.status,
  })
  if (!agent) {
    return Result.err(
      new AgentStatusError({
        message: 'Agent not found',
        status: 404,
      }),
    )
  }
  return Result.ok(toAgent(agent))
}

/**
 * Loads workspace id for archive/restore permission gating in the route.
 */
export async function resolveAgentWorkspaceForStatus(
  db: Db,
  agentId: string,
): Promise<ResultValue<{ workspaceId: string }, AgentStatusError>> {
  const existing = await getAgentWorkspaceHost(db, agentId)
  if (!existing) {
    return Result.err(
      new AgentStatusError({
        message: 'Agent not found',
        status: 404,
      }),
    )
  }
  return Result.ok({ workspaceId: existing.workspaceId })
}
