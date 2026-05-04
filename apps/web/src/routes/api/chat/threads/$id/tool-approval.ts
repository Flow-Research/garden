import { Result, TaggedError } from 'better-result'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { schema } from '@/lib/server/db'
import { parseJsonBody, toolApprovalBodySchema } from '@/lib/server/validation/chat'
import { json, notFound } from '@/lib/server/control-plane'
import { getThreadAccess } from '@/lib/server/chat-threads'

const textEncoder = new TextEncoder()

class ToolApprovalRouteError extends TaggedError('ToolApprovalRouteError')<{
  status: number
  message: string
}>() {}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    )
  }

  return value
}

function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalizeJson(value ?? null))
}

const agentProposalPayloadSchema = z.object({
  name: z.string(),
  role: z.string(),
  description: z.string().nullable().optional(),
  skills: z.array(z.string()).optional(),
  source_issue_id: z.string().uuid().nullable().optional(),
})

type ThreadAccess = Exclude<
  Awaited<ReturnType<typeof getThreadAccess>>,
  Response
>

type AgentProposalRequestRow = {
  id: string
  context: string | null
  payload_json: unknown
}

async function hashToolArgs(value: unknown) {
  return Result.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        textEncoder.encode(canonicalJsonString(value)),
      )
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
    },
    catch: () =>
      new ToolApprovalRouteError({
        status: 500,
        message: 'Failed to hash denied tool call arguments',
      }),
  })
}

function pendingAgentIdFromContext(value: string | null) {
  const prefix = 'agent_proposal:'
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null
}

async function loadAgentProposalRequest(args: {
  access: ThreadAccess
  permissionRequestId: string
}) {
  return Result.tryPromise({
    try: async () => {
      const rows = await args.access.db.execute<AgentProposalRequestRow>(sql`
        select
          pr.id,
          pr.context,
          pr.payload_json
        from permission_request pr
        join agent a on a.id = pr.agent_id
        where pr.id = ${args.permissionRequestId}::uuid
          and pr.kind = 'agent_proposal'
          and pr.status = 'pending'
          and a.workspace_id = ${args.access.thread.workspaceId}::uuid
        limit 1
      `)
      return [...rows.rows] as AgentProposalRequestRow[]
    },
    catch: () =>
      new ToolApprovalRouteError({
        status: 500,
        message: 'Failed to load agent proposal request',
      }),
  })
}

async function resolveAgentProposalApproval(args: {
  access: ThreadAccess
  permissionRequestId: string
  approved: boolean
}) {
  const requestResult = await loadAgentProposalRequest({
    access: args.access,
    permissionRequestId: args.permissionRequestId,
  })
  if (requestResult.isErr()) return requestResult

  const request = requestResult.value[0]
  if (!request) {
    return Result.err(
      new ToolApprovalRouteError({
        status: 404,
        message: 'Permission request not found',
      }),
    )
  }

  const pendingAgentId = pendingAgentIdFromContext(request.context)
  if (!pendingAgentId) {
    return Result.err(
      new ToolApprovalRouteError({
        status: 500,
        message: 'Agent proposal request is missing pending agent context',
      }),
    )
  }

  const payload = agentProposalPayloadSchema.safeParse(request.payload_json)
  if (!payload.success) {
    return Result.err(
      new ToolApprovalRouteError({
        status: 500,
        message: 'Agent proposal request payload is invalid',
      }),
    )
  }

  const resolvedAt = new Date()
  const sourceIssueId = payload.data.source_issue_id ?? null
  const resolveResult = await Result.tryPromise({
    try: async () => {
      await args.access.db.transaction(async (tx) => {
        await tx.execute(sql`
          update permission_request
          set
            status = ${args.approved ? 'approved' : 'denied'},
            resolved_by = ${args.access.session.user.id}::uuid,
            resolved_at = ${resolvedAt}
          where id = ${request.id}::uuid
            and kind = 'agent_proposal'
            and status = 'pending'
        `)

        const [agent] = await tx
          .update(schema.agent)
          .set({ status: args.approved ? 'active' : 'archived' })
          .where(
            and(
              eq(schema.agent.id, pendingAgentId),
              eq(schema.agent.workspaceId, args.access.thread.workspaceId),
              eq(schema.agent.status, 'pending_approval'),
            ),
          )
          .returning({ id: schema.agent.id })

        if (!agent) {
          throw new ToolApprovalRouteError({
            status: 404,
            message: 'Pending agent not found',
          })
        }

        if (args.approved && sourceIssueId) {
          await tx
            .update(schema.issue)
            .set({
              assigneeType: 'agent',
              assigneeId: pendingAgentId,
              updatedAt: resolvedAt,
            })
            .where(
              and(
                eq(schema.issue.id, sourceIssueId),
                eq(schema.issue.workspaceId, args.access.thread.workspaceId),
              ),
            )
        }
      })
    },
    catch: (cause) =>
      cause instanceof ToolApprovalRouteError
        ? cause
        : new ToolApprovalRouteError({
            status: 500,
            message: 'Failed to resolve agent proposal approval',
          }),
  })
  if (resolveResult.isErr()) return resolveResult

  return Result.ok({
    permissionRequestId: request.id,
    pendingAgentId,
    sourceIssueId,
  })
}

export const Route = createFileRoute('/api/chat/threads/$id/tool-approval')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          toolApprovalBodySchema,
          'Invalid tool approval payload',
        )
        if (bodyResult.isErr()) {
          return json({ error: bodyResult.error.message }, 400)
        }

        const { approved, permission_request_id: permissionRequestId } =
          bodyResult.value

        if (permissionRequestId) {
          const proposalResult = await resolveAgentProposalApproval({
            access,
            permissionRequestId,
            approved,
          })
          if (proposalResult.isErr()) {
            return json(
              { error: proposalResult.error.message },
              proposalResult.error.status,
            )
          }

          return Response.json({
            ok: true,
            permissionRequestIds: [proposalResult.value.permissionRequestId],
            pendingAgentId: proposalResult.value.pendingAgentId,
            sourceIssueId: proposalResult.value.sourceIssueId,
            invalidations: [
              'inbox',
              'agents',
              ...(proposalResult.value.sourceIssueId ? ['issues'] : []),
            ],
          })
        }

        const toolCallId = bodyResult.value.toolCallId
        if (!toolCallId) {
          return json({ error: 'Tool call id is required' }, 400)
        }

        const referenceRequestResult = await Result.tryPromise({
          try: async () =>
            access.db
              .select({
                agentId: schema.permissionRequest.agentId,
                capabilityId: schema.permissionRequest.capabilityId,
                argsJson: schema.permissionRequest.argsJson,
              })
              .from(schema.permissionRequest)
              .innerJoin(
                schema.agent,
                eq(schema.agent.id, schema.permissionRequest.agentId),
              )
              .where(
                and(
                  eq(schema.permissionRequest.toolCallId, toolCallId),
                  eq(schema.permissionRequest.status, 'pending'),
                  eq(schema.agent.workspaceId, access.thread.workspaceId),
                ),
              )
              .limit(1),
          catch: () =>
            new ToolApprovalRouteError({
              status: 500,
              message: 'Failed to load permission request',
            }),
        })
        if (referenceRequestResult.isErr()) {
          return json(
            { error: referenceRequestResult.error.message },
            referenceRequestResult.error.status,
          )
        }

        const referenceRequest = referenceRequestResult.value[0]
        if (!referenceRequest) {
          return notFound('Permission request not found')
        }

        const pendingRequestsResult = await Result.tryPromise({
          try: async () =>
            access.db
              .select({
                id: schema.permissionRequest.id,
                toolCallId: schema.permissionRequest.toolCallId,
                argsJson: schema.permissionRequest.argsJson,
              })
              .from(schema.permissionRequest)
              .where(
                and(
                  eq(schema.permissionRequest.agentId, referenceRequest.agentId),
                  eq(
                    schema.permissionRequest.capabilityId,
                    referenceRequest.capabilityId,
                  ),
                  eq(schema.permissionRequest.status, 'pending'),
                ),
              ),
          catch: () =>
            new ToolApprovalRouteError({
              status: 500,
              message: 'Failed to load matching permission requests',
            }),
        })
        if (pendingRequestsResult.isErr()) {
          return json(
            { error: pendingRequestsResult.error.message },
            pendingRequestsResult.error.status,
          )
        }

        const referenceArgsSignature = canonicalJsonString(referenceRequest.argsJson)
        const matchingRequestIds = pendingRequestsResult.value
          .filter(
            (candidate) =>
              canonicalJsonString(candidate.argsJson) === referenceArgsSignature,
          )
          .map((candidate) => candidate.id)

        if (matchingRequestIds.length === 0) {
          return notFound('Permission request not found')
        }

        const resolvedAt = new Date()
        const updateResult = await Result.tryPromise({
          try: async () =>
            access.db
              .update(schema.permissionRequest)
              .set({
                status: approved ? 'approved' : 'denied',
                resolvedBy: access.session.user.id,
                resolvedAt,
              })
              .where(inArray(schema.permissionRequest.id, matchingRequestIds))
              .returning({
                agentId: schema.permissionRequest.agentId,
                capabilityId: schema.permissionRequest.capabilityId,
                toolCallId: schema.permissionRequest.toolCallId,
                argsJson: schema.permissionRequest.argsJson,
              }),
          catch: () =>
            new ToolApprovalRouteError({
              status: 500,
              message: 'Failed to resolve permission request',
            }),
        })
        if (updateResult.isErr()) {
          return json({ error: updateResult.error.message }, updateResult.error.status)
        }

        if (!approved && updateResult.value.length > 0) {
          const auditRows: Array<typeof schema.toolCallAudit.$inferInsert> = []
          for (const entry of updateResult.value) {
            const argsHashResult = await hashToolArgs(entry.argsJson)
            if (argsHashResult.isErr()) {
              return json(
                { error: argsHashResult.error.message },
                argsHashResult.error.status,
              )
            }

            auditRows.push({
              id: crypto.randomUUID(),
              workspaceId: access.thread.workspaceId,
              agentId: entry.agentId,
              capabilityId: entry.capabilityId,
              toolCallId: entry.toolCallId,
              argsHash: argsHashResult.value,
              resultStatus: 'denied' as const,
              durationMs: 0,
              error: 'User denied approval',
            })
          }

          const auditInsertResult = await Result.tryPromise({
            try: async () => {
              await access.db.insert(schema.toolCallAudit).values(auditRows)
            },
            catch: () =>
              new ToolApprovalRouteError({
                status: 500,
                message: 'Failed to write denial audit rows',
              }),
          })
          if (auditInsertResult.isErr()) {
            return json(
              { error: auditInsertResult.error.message },
              auditInsertResult.error.status,
            )
          }
        }

        return Response.json({
          ok: true,
          toolCallIds: updateResult.value.map((entry) => entry.toolCallId),
        })
      },
    },
  },
})
