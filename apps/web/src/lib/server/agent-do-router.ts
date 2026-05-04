import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, eq } from 'drizzle-orm'
import type { AgentDO } from '@garden/agent-runtime'
import { agentSelectSchema, uuidSchema } from '@garden/db/validation'
import { getDb, schema } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'

export class AgentDoRouterError extends TaggedError('AgentDoRouterError')<{
  code: 'invalid_agent_id' | 'not_configured' | 'access_denied' | 'db_error'
  message: string
  cause?: unknown
}>() {}

export type AgentAccessAction =
  | 'connect'
  | 'thread'
  | 'issue_run'
  | 'debug'
  | 'tool_approval'

export type AgentDoRpcStub = DurableObjectStub<AgentDO>
type AgentDoNamespace = DurableObjectNamespace<AgentDO>

type AgentDoEnv = Pick<AppEnv, 'AGENT_DO' | 'DATABASE_URL'>
type AgentSession = { user?: { id?: string | null } | null } | null | undefined

const agentAccessRecordSchema = agentSelectSchema.pick({
  id: true,
  workspaceId: true,
  status: true,
})

function dbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new AgentDoRouterError({
    code: 'db_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

export function getAgentDoStub(
  env: { AGENT_DO?: AgentDoNamespace },
  agentId: string,
): ResultValue<AgentDoRpcStub, AgentDoRouterError> {
  const parsedAgentId = uuidSchema.safeParse(agentId)
  if (!parsedAgentId.success) {
    return Result.err(
      new AgentDoRouterError({
        code: 'invalid_agent_id',
        message: 'Agent id is invalid.',
      }),
    )
  }

  if (!env.AGENT_DO) {
    return Result.err(
      new AgentDoRouterError({
        code: 'not_configured',
        message: 'AgentDO runtime binding is not configured.',
      }),
    )
  }

  return Result.ok(env.AGENT_DO.get(env.AGENT_DO.idFromName(parsedAgentId.data)))
}

export async function requireAgentAccess(
  env: AgentDoEnv,
  agentId: string,
  session: AgentSession,
  action: AgentAccessAction,
): Promise<ResultValue<{ agentId: string; workspaceId: string }, AgentDoRouterError>> {
  const userId = session?.user?.id ?? null
  if (!userId) {
    return Result.err(
      new AgentDoRouterError({
        code: 'access_denied',
        message: 'Agent access denied.',
      }),
    )
  }

  const parsedAgentId = uuidSchema.safeParse(agentId)
  if (!parsedAgentId.success) {
    return Result.err(
      new AgentDoRouterError({
        code: 'invalid_agent_id',
        message: 'Agent id is invalid.',
      }),
    )
  }

  const result = await Result.tryPromise({
    try: async () => {
      const [row] = await getDb(env)
        .select({ agent: schema.agent })
        .from(schema.agent)
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.organizationId, schema.agent.workspaceId),
            eq(schema.member.userId, userId),
          ),
        )
        .where(eq(schema.agent.id, parsedAgentId.data))
        .limit(1)
      return row?.agent ?? null
    },
    catch: (cause) => dbError(`check agent access for ${action}`, cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (!result.value) {
    return Result.err(
      new AgentDoRouterError({
        code: 'access_denied',
        message: 'Agent access denied.',
      }),
    )
  }

  const parsedAgent = agentAccessRecordSchema.safeParse(result.value)
  if (!parsedAgent.success || parsedAgent.data.status === 'archived') {
    return Result.err(
      new AgentDoRouterError({
        code: 'access_denied',
        message: 'Agent access denied.',
      }),
    )
  }

  return Result.ok({
    agentId: parsedAgent.data.id,
    workspaceId: parsedAgent.data.workspaceId,
  })
}
