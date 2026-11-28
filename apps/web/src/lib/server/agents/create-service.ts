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

/**
 * Allowlisted DB failure fields for Worker logs. Drizzle 0.45 can put bound
 * INSERT values (instructions, runtime_config) in `Error.message`, so never
 * log the raw message here — keep `cause` on the TaggedError for trusted
 * diagnosis instead.
 */
function agentCreateLogFields(cause: unknown) {
  const fields: {
    errorName?: string
    dbCode?: string
    dbConstraint?: string
  } = {}
  if (cause instanceof Error) fields.errorName = cause.name

  const seen = new Set<unknown>()
  let current: unknown = cause
  while (
    current !== null &&
    typeof current === 'object' &&
    !seen.has(current)
  ) {
    seen.add(current)
    const record = current as {
      code?: unknown
      constraint?: unknown
      cause?: unknown
      name?: unknown
    }
    if (
      typeof record.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(record.code) &&
      !fields.dbCode
    ) {
      fields.dbCode = record.code
    }
    if (typeof record.constraint === 'string' && !fields.dbConstraint) {
      fields.dbConstraint = record.constraint
    }
    if (typeof record.name === 'string' && !fields.errorName) {
      fields.errorName = record.name
    }
    current = record.cause
  }
  return fields
}

/**
 * Inserts an agent and seeds its default capability grants in one
 * transaction, so a failed grant write leaves no agent row behind.
 */
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

      const agent = await input.db.transaction(async (tx) => {
        const inserted = await insertAgent(tx, agentValues)
        await bindExistingCapabilitiesToAgent({
          db: tx,
          agentId: inserted.id,
          grantedBy: input.ownerUserId,
        })
        return inserted
      })
      return toAgent(agent)
    },
    catch: (cause) => {
      // Fixed HTTP message; allowlisted log fields only (no raw driver text).
      logger.error('agent.create_failed', {
        workspaceId: input.workspaceId,
        operation: 'create_agent',
        ...agentCreateLogFields(cause),
      })
      return new AgentCreateError({
        message: 'Failed to create agent',
        status: 500,
        cause,
      })
    },
  })
}
