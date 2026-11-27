import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import type { AgentPermissions } from '@garden/core/agents/permissions'
import { toAgent } from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import {
  listChatThreadIdsForAgent,
  updateAgentById,
} from '@/lib/server/queries/agents'

export class AgentUpdateError extends TaggedError('AgentUpdateError')<{
  message: string
  status: number
}>() {}

export type UpdateAgentBody = {
  name?: string
  description?: string | null
  instructions?: string | null
  runtime_config?: Record<string, unknown> | null
  permissions?: AgentPermissions
}

export type UpdateAgentResult = {
  agent: ReturnType<typeof toAgent>
  hostName: string | null
  threadIds: string[]
}

function buildUpdateValues(
  body: UpdateAgentBody,
): Partial<typeof schema.agent.$inferInsert> {
  const updateValues: Partial<typeof schema.agent.$inferInsert> = {}
  if (typeof body.name === 'string') updateValues.name = body.name
  if (typeof body.description === 'string') {
    updateValues.roleTitle = body.description
  }
  if (typeof body.instructions === 'string') {
    updateValues.instructions = body.instructions
  }
  if (Object.prototype.hasOwnProperty.call(body, 'runtime_config')) {
    updateValues.persona =
      body.runtime_config && typeof body.runtime_config === 'object'
        ? JSON.stringify(body.runtime_config)
        : null
  }
  if (
    Object.prototype.hasOwnProperty.call(body, 'permissions') &&
    body.permissions !== undefined
  ) {
    updateValues.permissions = body.permissions
  }
  return updateValues
}

/**
 * Updates an agent. Callers must check `agentManage` first. Returns the
 * agent's chat thread ids so the caller can refresh their prompt config; that
 * refresh does not roll back the update.
 */
export async function updateWorkspaceAgent(input: {
  db: Db
  agentId: string
  workspaceId: string
  hostName: string | null
  body: UpdateAgentBody
}): Promise<ResultValue<UpdateAgentResult, AgentUpdateError>> {
  const updateValues = buildUpdateValues(input.body)
  if (Object.keys(updateValues).length === 0) {
    return Result.err(
      new AgentUpdateError({
        message: 'No valid agent changes submitted',
        status: 400,
      }),
    )
  }

  const agent = await updateAgentById(input.db, {
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    values: updateValues,
  })
  if (!agent) {
    return Result.err(
      new AgentUpdateError({
        message: 'Agent not found',
        status: 404,
      }),
    )
  }

  const threads = input.hostName
    ? await listChatThreadIdsForAgent(input.db, input.agentId)
    : []

  return Result.ok({
    agent: toAgent(agent),
    hostName: input.hostName,
    threadIds: threads.map((thread) => thread.id),
  })
}
