import { Result, TaggedError } from 'better-result'
import { and, eq, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { schema } from '@/lib/server/db'
import { parseJsonBody, toolApprovalBodySchema } from '@/lib/server/validation/chat'
import { json } from '@/lib/server/control-plane'
import { getThreadAccess } from '@/lib/server/chat-threads'
import { resolveConnectorWritePermissionRequests } from '@/lib/server/permission-request'

class ToolApprovalRouteError extends TaggedError('ToolApprovalRouteError')<{
  status: number
  message: string
}>() {}

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

        const resolutionResult = await resolveConnectorWritePermissionRequests({
          approved,
          actorUserId: access.session.user.id,
          db: access.db,
          toolCallId,
          workspaceId: access.thread.workspaceId,
        })
        if (resolutionResult.isErr()) {
          return json(
            { error: resolutionResult.error.message },
            resolutionResult.error.status,
          )
        }

        return Response.json({
          ok: true,
          toolCallIds: resolutionResult.value.toolCallIds,
        })
      },
    },
  },
})
