import { Result, TaggedError } from 'better-result'
import { and, eq, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { archiveInboxItemsByKey } from '@garden/db/inbox'
import { appEnv } from '@/lib/server/env'
import { getDb, schema } from '@/lib/server/db'
import { json, requireWorkspaceAccess } from '@/lib/server/control-plane'
import { parseJsonBody } from '@/lib/server/validation/common'
import { resolveConnectorWritePermissionRequests } from '@/lib/server/permission-request'
import { startIssueRun } from '@garden/core/issues/run-service'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

class PermissionResolveError extends TaggedError('PermissionResolveError')<{
  status: number
  message: string
  cause?: unknown
}>() {}

const resolvePermissionBodySchema = z.object({
  approved: z.boolean(),
})

const agentProposalPayloadSchema = z.object({
  source_issue_id: z.string().uuid().nullable().optional(),
})

type PermissionRequestRow = {
  id: string
  workspaceId: string
  agentId: string
  kind: string
  status: string
  context: string | null
  argsJson: unknown
  issueId: string | null
}

function pendingAgentIdFromContext(value: string | null) {
  const prefix = 'agent_proposal:'
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null
}

async function loadPermissionRequest(id: string) {
  const db = getDb(appEnv)
  return Result.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          id: schema.permissionRequest.id,
          workspaceId: schema.agent.workspaceId,
          agentId: schema.permissionRequest.agentId,
          kind: schema.permissionRequest.kind,
          status: schema.permissionRequest.status,
          context: schema.permissionRequest.context,
          argsJson: schema.permissionRequest.argsJson,
          issueId: schema.permissionRequest.issueId,
        })
        .from(schema.permissionRequest)
        .innerJoin(
          schema.agent,
          eq(schema.agent.id, schema.permissionRequest.agentId),
        )
        .where(eq(schema.permissionRequest.id, id))
        .limit(1)
      return rows[0] ?? null
    },
    catch: (cause) =>
      new PermissionResolveError({
        status: 500,
        message: 'Failed to load permission request',
        cause,
      }),
  })
}

async function resolveAgentProposal(args: {
  actorUserId: string
  approved: boolean
  request: PermissionRequestRow
}) {
  const pendingAgentId = pendingAgentIdFromContext(args.request.context)
  if (!pendingAgentId) {
    return Result.err(
      new PermissionResolveError({
        status: 500,
        message: 'Agent proposal request is missing pending agent context',
      }),
    )
  }

  if (args.request.status !== 'pending') {
    return Result.ok({ sourceIssueId: null as string | null })
  }

  const payload = agentProposalPayloadSchema.safeParse(args.request.argsJson)
  if (!payload.success) {
    return Result.err(
      new PermissionResolveError({
        status: 500,
        message: 'Agent proposal request payload is invalid',
      }),
    )
  }

  const db = getDb(appEnv)
  const resolvedAt = new Date()
  const sourceIssueId = payload.data.source_issue_id ?? args.request.issueId
  const updateResult = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<{ agent_id: string }>(sql`
        with resolved_request as (
          update permission_request
          set
            status = ${args.approved ? 'approved' : 'denied'},
            resolved_by = ${args.actorUserId}::uuid,
            resolved_at = ${resolvedAt}
          where id = ${args.request.id}::uuid
            and kind = 'agent_proposal'
            and status = 'pending'
          returning id
        ),
        updated_agent as (
          update agent
          set status = ${args.approved ? 'active' : 'archived'}
          where id = ${pendingAgentId}::uuid
            and workspace_id = ${args.request.workspaceId}::uuid
            and status = 'pending_approval'
            and exists (select 1 from resolved_request)
          returning id as agent_id
        )
        select agent_id from updated_agent
      `)
      return [...rows.rows]
    },
    catch: (cause) =>
      new PermissionResolveError({
        status: 500,
        message: 'Failed to resolve agent proposal',
        cause,
      }),
  })
  if (updateResult.isErr()) return Result.err(updateResult.error)
  if (updateResult.value.length === 0) {
    return Result.err(
      new PermissionResolveError({
        status: 404,
        message: 'Pending agent not found',
      }),
    )
  }

  if (args.approved && sourceIssueId) {
    const assignResult = await Result.tryPromise({
      try: async () => {
        await db
          .update(schema.issue)
          .set({
            assigneeType: 'agent',
            assigneeId: pendingAgentId,
            updatedAt: resolvedAt,
          })
          .where(
            and(
              eq(schema.issue.id, sourceIssueId),
              eq(schema.issue.workspaceId, args.request.workspaceId),
            ),
          )
      },
      catch: (cause) =>
        new PermissionResolveError({
          status: 500,
          message: 'Failed to assign approved agent',
          cause,
        }),
    })
    if (assignResult.isErr()) return Result.err(assignResult.error)

    const runResult = await startIssueRun(appEnv, {
      workspaceId: args.request.workspaceId,
      issueId: sourceIssueId,
      agentId: pendingAgentId,
      source: 'hire_approval',
      trigger: { correlationId: args.request.id },
      actor: { type: 'member', id: args.actorUserId },
    })
    if (runResult.isErr()) console.error(runResult.error.message)
  }

  return Result.ok({ sourceIssueId })
}

export const Route = createFileRoute('/api/permission-requests/$id/resolve')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const bodyResult = await parseJsonBody(
          request,
          resolvePermissionBodySchema,
          'Invalid permission resolve payload',
        )
        if (bodyResult.isErr()) {
          return json({ error: bodyResult.error.message }, 400)
        }

        const requestResult = await loadPermissionRequest(params.id)
        if (requestResult.isErr()) {
          return json(
            { error: requestResult.error.message },
            requestResult.error.status,
          )
        }
        if (!requestResult.value)
          return json({ error: 'Permission request not found' }, 404)

        const permissionRequest = requestResult.value
        const access = await requireWorkspaceAccess(
          request,
          permissionRequest.workspaceId,
        )
        if (access instanceof Response) return access
        const permission = await requireWorkspacePermission({
          request,
          workspaceId: permissionRequest.workspaceId,
          permissions: workspacePermissions.permissionManage,
        })
        if (permission) return permission

        if (permissionRequest.kind === 'agent_proposal') {
          const proposalResult = await resolveAgentProposal({
            actorUserId: access.session.user.id,
            approved: bodyResult.value.approved,
            request: permissionRequest,
          })
          if (proposalResult.isErr()) {
            return json(
              { error: proposalResult.error.message },
              proposalResult.error.status,
            )
          }
          await archiveInboxItemsByKey({
            db: getDb(appEnv),
            workspaceId: permissionRequest.workspaceId,
            itemKeys: [`approval:${permissionRequest.id}`],
          })
          return Response.json({
            ok: true,
            invalidations: [
              'inbox',
              'agents',
              ...(proposalResult.value.sourceIssueId ? ['issues'] : []),
            ],
          })
        }

        const resolutionResult = await resolveConnectorWritePermissionRequests({
          approved: bodyResult.value.approved,
          actorUserId: access.session.user.id,
          db: getDb(appEnv),
          permissionRequestId: permissionRequest.id,
          workspaceId: permissionRequest.workspaceId,
        })
        if (resolutionResult.isErr()) {
          return json(
            { error: resolutionResult.error.message },
            resolutionResult.error.status,
          )
        }
        await archiveInboxItemsByKey({
          db: getDb(appEnv),
          workspaceId: permissionRequest.workspaceId,
          itemKeys: [`approval:${permissionRequest.id}`],
        })

        return Response.json({
          ok: true,
          invalidations: ['inbox', 'issues'],
        })
      },
    },
  },
})
