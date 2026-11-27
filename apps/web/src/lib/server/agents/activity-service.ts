import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import type { Db } from '@/lib/server/db'
import {
  listAgentGrantActivity,
  listAgentToolDecisions,
} from '@/lib/server/queries/agents'
import { agentExistsInWorkspace } from '@/lib/server/queries/issues/agents'

export class AgentActivityError extends TaggedError('AgentActivityError')<{
  message: string
  status: number
}>() {}

type GrantPayload = {
  scope?: unknown
  connector_id?: unknown
  tool_name?: unknown
  trust?: unknown
}

function grantDetail(payload: unknown) {
  const detail = (payload ?? {}) as GrantPayload
  return {
    scope: typeof detail.scope === 'string' ? detail.scope : null,
    connector_id:
      typeof detail.connector_id === 'string' ? detail.connector_id : null,
    tool_name: typeof detail.tool_name === 'string' ? detail.tool_name : null,
    trust: typeof detail.trust === 'string' ? detail.trust : null,
  }
}

function mergeActivityEvents(
  decisions: Awaited<ReturnType<typeof listAgentToolDecisions>>,
  grantChanges: Awaited<ReturnType<typeof listAgentGrantActivity>>,
) {
  return [
    ...decisions.map((decision) => ({
      id: decision.id,
      kind: 'tool_decision' as const,
      tool_call_id: decision.toolCallId,
      connector_id: decision.connectorId,
      tool_name: decision.toolName,
      result_status: decision.resultStatus,
      error: decision.error,
      timestamp: decision.timestamp,
    })),
    ...grantChanges.map((change) => ({
      id: change.id,
      kind: 'grant_change' as const,
      event_type: change.eventType,
      ...grantDetail(change.payload),
      timestamp: change.timestamp,
    })),
  ]
    .sort(
      (left, right) =>
        new Date(right.timestamp ?? 0).getTime() -
        new Date(left.timestamp ?? 0).getTime(),
    )
    .slice(0, 50)
}

type AgentActivityEvent = ReturnType<typeof mergeActivityEvents>[number]

/**
 * Merges tool decisions and grant changes into the newest 50 agent activity
 * events. The route owns session and workspace checks.
 */
export async function getAgentActivityFeed(input: {
  db: Db
  workspaceId: string
  agentId: string
}): Promise<ResultValue<{ events: AgentActivityEvent[] }, AgentActivityError>> {
  const existsResult = await Result.tryPromise({
    try: async () =>
      await agentExistsInWorkspace(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    catch: () =>
      new AgentActivityError({
        status: 500,
        message: 'Failed to load agent for activity feed',
      }),
  })
  if (existsResult.isErr()) return Result.err(existsResult.error)
  if (!existsResult.value) {
    return Result.err(
      new AgentActivityError({
        status: 404,
        message: 'Agent not found',
      }),
    )
  }

  const feedResult = await Result.tryPromise({
    try: async () => {
      const [decisions, grantChanges] = await Promise.all([
        listAgentToolDecisions(input.db, {
          workspaceId: input.workspaceId,
          agentId: input.agentId,
        }),
        listAgentGrantActivity(input.db, {
          workspaceId: input.workspaceId,
          agentId: input.agentId,
        }),
      ])
      return { decisions, grantChanges }
    },
    catch: () =>
      new AgentActivityError({
        status: 500,
        message: 'Failed to load agent activity feed',
      }),
  })
  if (feedResult.isErr()) return Result.err(feedResult.error)

  const events = mergeActivityEvents(
    feedResult.value.decisions,
    feedResult.value.grantChanges,
  )

  return Result.ok({ events })
}
