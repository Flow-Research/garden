import { Result, TaggedError } from 'better-result'
import { and, desc, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  json,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'

class AgentActivityRouteError extends TaggedError('AgentActivityRouteError')<{
  status: number
  message: string
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

export const Route = createFileRoute('/api/agents/$id/activity')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const db = await appContext.db()

        const agentResult = await Result.tryPromise({
          try: async () =>
            db
              .select({ id: schema.agent.id })
              .from(schema.agent)
              .where(
                and(
                  eq(schema.agent.id, params.id),
                  eq(schema.agent.workspaceId, workspaceId),
                ),
              )
              .limit(1),
          catch: () =>
            new AgentActivityRouteError({
              status: 500,
              message: 'Failed to load agent for activity feed',
            }),
        })
        if (agentResult.isErr()) {
          return json(
            { error: agentResult.error.message },
            agentResult.error.status,
          )
        }

        if (!agentResult.value[0]) {
          return notFound('Agent not found')
        }

        const feedResult = await Result.tryPromise({
          try: async () => {
            const [decisions, grantChanges] = await Promise.all([
              db
                .select({
                  id: schema.toolCallAudit.id,
                  toolCallId: schema.toolCallAudit.toolCallId,
                  toolName: schema.capability.name,
                  connectorId: schema.capability.connectorType,
                  resultStatus: schema.toolCallAudit.resultStatus,
                  error: schema.toolCallAudit.error,
                  timestamp: schema.toolCallAudit.ts,
                })
                .from(schema.toolCallAudit)
                .innerJoin(
                  schema.capability,
                  eq(schema.toolCallAudit.capabilityId, schema.capability.id),
                )
                .where(
                  and(
                    eq(schema.toolCallAudit.workspaceId, workspaceId),
                    eq(schema.toolCallAudit.agentId, params.id),
                  ),
                )
                .orderBy(desc(schema.toolCallAudit.ts))
                .limit(50),
              db
                .select({
                  id: schema.activityEvent.id,
                  eventType: schema.activityEvent.eventType,
                  payload: schema.activityEvent.payload,
                  timestamp: schema.activityEvent.createdAt,
                })
                .from(schema.activityEvent)
                .where(
                  and(
                    eq(schema.activityEvent.workspaceId, workspaceId),
                    eq(schema.activityEvent.subjectType, 'agent'),
                    eq(schema.activityEvent.subjectId, params.id),
                  ),
                )
                .orderBy(desc(schema.activityEvent.createdAt))
                .limit(50),
            ])
            return { decisions, grantChanges }
          },
          catch: () =>
            new AgentActivityRouteError({
              status: 500,
              message: 'Failed to load agent activity feed',
            }),
        })
        if (feedResult.isErr()) {
          return json(
            { error: feedResult.error.message },
            feedResult.error.status,
          )
        }

        const events = [
          ...feedResult.value.decisions.map((decision) => ({
            id: decision.id,
            kind: 'tool_decision' as const,
            tool_call_id: decision.toolCallId,
            connector_id: decision.connectorId,
            tool_name: decision.toolName,
            result_status: decision.resultStatus,
            error: decision.error,
            timestamp: decision.timestamp,
          })),
          ...feedResult.value.grantChanges.map((change) => ({
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

        return Response.json({ events })
      },
    },
  },
})
