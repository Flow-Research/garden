import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { createLogger } from '@garden/observability/console'
import { toAgent } from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import {
  bindExistingCapabilitiesToAgent,
  insertAgent,
} from '@/lib/server/queries/agents'

const logger = createLogger('agent-create-service')

export class AgentCreateError extends TaggedError('AgentCreateError')<{
  message: string
  status: number
  cause?: unknown
}>() {}

export type CreateAgentInput = {
  db: Db
  workspaceId: string
  ownerUserId: string
  name: string
  description?: string | null
  instructions?: string | null
  runtimeConfig?: Record<string, unknown> | null
}

/** Inserts an agent and seeds its default capability grants. */
export async function createWorkspaceAgent(
  input: CreateAgentInput,
): Promise<ResultValue<ReturnType<typeof toAgent>, AgentCreateError>> {
  return Result.tryPromise({
    try: async () => {
      const agentId = crypto.randomUUID()
      const agentValues = {
        id: agentId,
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        name: input.name,
        roleTitle:
          typeof input.description === 'string' ? input.description : null,
        instructions:
          typeof input.instructions === 'string' ? input.instructions : null,
        persona:
          input.runtimeConfig && typeof input.runtimeConfig === 'object'
            ? JSON.stringify(input.runtimeConfig)
            : null,
        status: 'active',
        hostName: agentId,
        permissions: DEFAULT_AGENT_PERMISSIONS,
      } as typeof schema.agent.$inferInsert

      const agent = await insertAgent(input.db, agentValues)
      await bindExistingCapabilitiesToAgent({
        db: input.db,
        agentId: agent.id,
        grantedBy: input.ownerUserId,
      })
      return toAgent(agent)
    },
    catch: (cause) => {
      // Fixed client message — do not leak driver/DB text into the HTTP body.
      logger.error('agent.create_failed', {
        workspaceId: input.workspaceId,
        error: cause instanceof Error ? cause.message : String(cause),
      })
      return new AgentCreateError({
        message: 'Failed to create agent',
        status: 500,
        cause,
      })
    },
  })
}
