import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { startIssueRun } from '@garden/server/issues/run-service'
import type { AppEnv } from './env'
import { schema, type Db } from './db'

const agentProposalPayloadSchema = z.object({
  source_issue_id: z.string().uuid().nullable().optional(),
})

export type AgentProposalRequestRow = {
  id: string
  workspaceId: string
  agentId: string
  pendingAgentId: string
  issueId: string | null
  argsJson: unknown
  status: string
}

export class AgentProposalRequestServiceError extends TaggedError(
  'AgentProposalRequestServiceError',
)<{
  code:
    | 'database_failed'
    | 'proposal_payload_invalid'
    | 'proposal_request_not_found'
    | 'pending_agent_not_found'
  status: number
  message: string
  cause?: unknown
}>() {}

function serviceError(
  values: ConstructorParameters<typeof AgentProposalRequestServiceError>[0],
) {
  return new AgentProposalRequestServiceError(values)
}

/**
 * Loads a proposal through its proposing agent so every caller gets the
 * authoritative workspace boundary. The mixed permission ledger previously
 * required context parsing; the dedicated row exposes pendingAgentId directly.
 */
export async function loadAgentProposalRequest(args: {
  db: Db
  requestId: string
  workspaceId?: string
}): Promise<
  ResultValue<AgentProposalRequestRow | null, AgentProposalRequestServiceError>
> {
  const result = await Result.tryPromise({
    try: async () => {
      const rows = await args.db
        .select({
          id: schema.agentProposalRequest.id,
          workspaceId: schema.agent.workspaceId,
          agentId: schema.agentProposalRequest.agentId,
          pendingAgentId: schema.agentProposalRequest.pendingAgentId,
          issueId: schema.agentProposalRequest.issueId,
          argsJson: schema.agentProposalRequest.argsJson,
          status: schema.agentProposalRequest.status,
        })
        .from(schema.agentProposalRequest)
        .innerJoin(
          schema.agent,
          eq(schema.agent.id, schema.agentProposalRequest.agentId),
        )
        .where(
          and(
            eq(schema.agentProposalRequest.id, args.requestId),
            args.workspaceId
              ? eq(schema.agent.workspaceId, args.workspaceId)
              : undefined,
          ),
        )
        .limit(1)
      return rows[0] ?? null
    },
    catch: (cause) =>
      serviceError({
        code: 'database_failed',
        status: 500,
        message: 'Failed to load agent proposal request',
        cause,
      }),
  })

  return result.isOk() ? Result.ok(result.value) : Result.err(result.error)
}

export type ResolveAgentProposalRequestInput = {
  actorUserId: string
  approved: boolean
  db: Db
  env: AppEnv
  requestId: string
  runActor: { type: 'agent' | 'member'; id: string }
  workspaceId: string
}

export type ResolveAgentProposalRequestOutcome = {
  permissionRequestId: string
  pendingAgentId: string
  sourceIssueId: string | null
}

/**
 * Resolves a Garden agent proposal, activates or archives its pending agent,
 * and assigns/wakes the optional source issue. Both chat and inbox routes used
 * to duplicate this transaction against permission_request; one service now
 * owns proposal semantics while connector approvals stay in their old service.
 */
export async function resolveAgentProposalRequest(
  input: ResolveAgentProposalRequestInput,
): Promise<
  ResultValue<
    ResolveAgentProposalRequestOutcome,
    AgentProposalRequestServiceError
  >
> {
  const requestResult = await loadAgentProposalRequest({
    db: input.db,
    requestId: input.requestId,
    workspaceId: input.workspaceId,
  })
  if (requestResult.isErr()) return Result.err(requestResult.error)

  const request = requestResult.value
  if (!request) {
    return Result.err(
      serviceError({
        code: 'proposal_request_not_found',
        status: 404,
        message: 'Agent proposal request not found',
      }),
    )
  }

  if (request.status !== 'pending') {
    return Result.ok({
      permissionRequestId: request.id,
      pendingAgentId: request.pendingAgentId,
      sourceIssueId: null,
    })
  }

  const payload = agentProposalPayloadSchema.safeParse(request.argsJson)
  if (!payload.success) {
    return Result.err(
      serviceError({
        code: 'proposal_payload_invalid',
        status: 500,
        message: 'Agent proposal request payload is invalid',
      }),
    )
  }

  const sourceIssueId = payload.data.source_issue_id ?? request.issueId
  const resolvedAt = new Date()
  const resolveResult = await Result.tryPromise({
    try: async () =>
      input.db.transaction(async (tx) => {
        const [resolvedRequest] = await tx
          .update(schema.agentProposalRequest)
          .set({
            status: input.approved ? 'approved' : 'denied',
            resolvedBy: input.actorUserId,
            resolvedAt,
          })
          .where(
            and(
              eq(schema.agentProposalRequest.id, request.id),
              eq(schema.agentProposalRequest.status, 'pending'),
            ),
          )
          .returning({ id: schema.agentProposalRequest.id })

        if (!resolvedRequest) return false

        const [updatedAgent] = await tx
          .update(schema.agent)
          .set({ status: input.approved ? 'active' : 'archived' })
          .where(
            and(
              eq(schema.agent.id, request.pendingAgentId),
              eq(schema.agent.workspaceId, input.workspaceId),
              eq(schema.agent.status, 'pending_approval'),
            ),
          )
          .returning({ id: schema.agent.id })

        if (!updatedAgent) {
          throw serviceError({
            code: 'pending_agent_not_found',
            status: 404,
            message: 'Pending agent not found',
          })
        }

        if (input.approved && sourceIssueId) {
          await tx
            .update(schema.issue)
            .set({
              assigneeType: 'agent',
              assigneeId: request.pendingAgentId,
              updatedAt: resolvedAt,
            })
            .where(
              and(
                eq(schema.issue.id, sourceIssueId),
                eq(schema.issue.workspaceId, input.workspaceId),
              ),
            )
        }

        return true
      }),
    catch: (cause) =>
      cause instanceof AgentProposalRequestServiceError
        ? cause
        : serviceError({
            code: 'database_failed',
            status: 500,
            message: 'Failed to resolve agent proposal request',
            cause,
          }),
  })
  if (resolveResult.isErr()) return Result.err(resolveResult.error)

  if (resolveResult.value && input.approved && sourceIssueId) {
    const runResult = await startIssueRun(input.env, {
      workspaceId: input.workspaceId,
      issueId: sourceIssueId,
      agentId: request.pendingAgentId,
      source: 'hire_approval',
      trigger: { correlationId: request.id },
      actor: input.runActor,
    })
    if (runResult.isErr()) console.error(runResult.error.message)
  }

  return Result.ok({
    permissionRequestId: request.id,
    pendingAgentId: request.pendingAgentId,
    sourceIssueId: resolveResult.value ? sourceIssueId : null,
  })
}
