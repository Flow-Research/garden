import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, eq, or } from 'drizzle-orm'
import { agentSelectSchema, uuidSchema } from '@garden/db/validation'
import { getDb, schema } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'

export class AgentDoRouterError extends TaggedError('AgentDoRouterError')<{
  code: 'access_denied' | 'db_error' | 'invalid_agent_id'
  message: string
  cause?: unknown
}>() {}

export type AgentAccessAction =
  | 'connect'
  | 'thread'
  | 'issue_run'
  | 'debug'
  | 'tool_approval'

type AgentDoEnv = Pick<AppEnv, 'AgentDO' | 'HYPERDRIVE'>
type AgentSession = { user?: { id?: string | null } | null } | null | undefined

const agentAccessRecordSchema = agentSelectSchema.pick({
  id: true,
  workspaceId: true,
  status: true,
})
const AGENT_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/

export function isAgentRuntimeName(value: string) {
  return AGENT_RUNTIME_NAME_PATTERN.test(value)
}

function dbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new AgentDoRouterError({
    code: 'db_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

export async function requireAgentAccess(
  env: AgentDoEnv,
  agentRuntimeName: string,
  session: AgentSession,
  action: AgentAccessAction,
): Promise<
  ResultValue<{ agentId: string; workspaceId: string }, AgentDoRouterError>
> {
  const userId = session?.user?.id ?? null
  if (!userId) {
    return Result.err(
      new AgentDoRouterError({
        code: 'access_denied',
        message: 'Agent access denied.',
      }),
    )
  }

  if (!agentRuntimeName || !isAgentRuntimeName(agentRuntimeName)) {
    return Result.err(
      new AgentDoRouterError({
        code: 'invalid_agent_id',
        message: 'Agent runtime name is invalid.',
      }),
    )
  }
  const parsedAgentId = uuidSchema.safeParse(agentRuntimeName)

  const result = await Result.tryPromise({
    try: async () => {
      const db = await getDb(env)
      const [row] = await db
        .select({ agent: schema.agent })
        .from(schema.agent)
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.organizationId, schema.agent.workspaceId),
            eq(schema.member.userId, userId),
          ),
        )
        .where(
          parsedAgentId.success
            ? or(
                eq(schema.agent.id, parsedAgentId.data),
                eq(schema.agent.hostName, agentRuntimeName),
              )
            : eq(schema.agent.hostName, agentRuntimeName),
        )
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
