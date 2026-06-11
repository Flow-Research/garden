import { and, eq, inArray } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { LIVE_RUN_STATUSES } from '@garden/core/issues/run-sync'
import type { IssueStatus } from '@garden/core/types/issue'
import {
  archiveTerminalIssueInbox,
  upsertIssueAssignmentInbox,
} from '@garden/db/inbox'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { parseJsonBody, updateIssueBodySchema } from '@/lib/server/validation/issues'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
  toIssue,
} from '@/lib/server/control-plane'
import { cancelIssueRun, startIssueRun } from '@garden/server/issues/run-service'
import {
  cancelLiveRunsOnIssueChange,
} from '@garden/core/issues/run-sync'

export const Route = createFileRoute('/api/issues/$id')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const [issue] = await db
          .select()
          .from(schema.issue)
          .where(
            and(
              eq(schema.issue.id, params.id),
              eq(schema.issue.workspaceId, existingIssue.workspaceId),
            ),
          )

        if (!issue) return notFound('Issue not found')
        return Response.json(toIssue(issue))
      },
      PUT: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const bodyResult = await parseJsonBody(
          request,
          updateIssueBodySchema,
          'Invalid issue payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const updateValues: Partial<typeof schema.issue.$inferInsert> = {}

        if (typeof body.title === 'string') updateValues.title = body.title
        if (Object.prototype.hasOwnProperty.call(body, 'description')) {
          updateValues.description = body.description ?? null
        }
        if (body.status) updateValues.status = body.status
        if (body.priority) updateValues.priority = body.priority
        if (typeof body.position === 'number') updateValues.position = body.position
        if (Object.prototype.hasOwnProperty.call(body, 'due_date')) {
          updateValues.dueDate = body.due_date ? new Date(body.due_date) : null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'assignee_id')) {
          updateValues.assigneeId = body.assignee_id ?? null
          updateValues.assigneeType =
            typeof body.assignee_id === 'string'
              ? body.assignee_type === 'agent'
                ? 'agent'
                : 'user'
              : null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'parent_issue_id')) {
          updateValues.parentId = body.parent_issue_id ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'project_id')) {
          updateValues.projectId = body.project_id ?? null
        }

        if (Object.keys(updateValues).length === 0) {
          return badRequest('No valid issue changes submitted')
        }

        updateValues.updatedAt = new Date()

        const db = await appContext.db()
        const [existingIssue] = await db
          .select({
            workspaceId: schema.issue.workspaceId,
            status: schema.issue.status,
            assigneeType: schema.issue.assigneeType,
            assigneeId: schema.issue.assigneeId,
            activeRunId: schema.issue.activeRunId,
          })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const [issue] = await db
          .update(schema.issue)
          .set(updateValues)
          .where(
            and(
              eq(schema.issue.id, params.id),
              eq(schema.issue.workspaceId, existingIssue.workspaceId),
            ),
          )
          .returning()

        if (!issue) return notFound('Issue not found')
        if (
          issue.assigneeType === 'user' &&
          issue.assigneeId &&
          (existingIssue.assigneeType !== issue.assigneeType ||
            existingIssue.assigneeId !== issue.assigneeId)
        ) {
          await upsertIssueAssignmentInbox({
            db,
            workspaceId: existingIssue.workspaceId,
            issueId: issue.id,
            actorType: 'member',
            actorId: access.session.user.id,
          })
        }
        if (issue.status === 'done' || issue.status === 'cancelled') {
          await archiveTerminalIssueInbox({
            db,
            workspaceId: existingIssue.workspaceId,
            issueId: issue.id,
          })
        }
        const syncDecision = cancelLiveRunsOnIssueChange({
          currentStatus: (existingIssue.status ?? 'backlog') as IssueStatus,
          nextStatus: (issue.status ?? 'backlog') as IssueStatus,
          currentAssigneeType: existingIssue.assigneeType as
            | 'user'
            | 'member'
            | 'agent'
            | null,
          currentAssigneeId: existingIssue.assigneeId,
          nextAssigneeType: issue.assigneeType as
            | 'user'
            | 'member'
            | 'agent'
            | null,
          nextAssigneeId: issue.assigneeId,
        })

        if (syncDecision.cancelLiveRuns) {
          const liveRuns = await db
            .select({ id: schema.issueRun.id })
            .from(schema.issueRun)
            .where(
              and(
                eq(schema.issueRun.issueId, issue.id),
                inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
                ...(syncDecision.cancelAgentId
                  ? [eq(schema.issueRun.agentId, syncDecision.cancelAgentId)]
                  : []),
              ),
            )
          for (const run of liveRuns) {
            const cancelResult = await cancelIssueRun(appEnv, {
              workspaceId: existingIssue.workspaceId,
              runId: run.id,
              actor: { type: 'member', id: access.session.user.id },
              reason: 'issue_changed',
            })
            if (cancelResult.isErr()) console.error(cancelResult.error.message)
          }
        }

        if (
          syncDecision.shouldWakeAgent &&
          issue.assigneeId
        ) {
          const startResult = await startIssueRun(appEnv, {
            workspaceId: existingIssue.workspaceId,
            issueId: issue.id,
            agentId: issue.assigneeId,
            source: 'assignment',
            actor: { type: 'member', id: access.session.user.id },
          })
          if (startResult.isErr()) console.error(startResult.error.message)
        }
        return Response.json(toIssue(issue))
      },
      DELETE: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        await db.delete(schema.issue).where(
          and(
            eq(schema.issue.id, params.id),
            eq(schema.issue.workspaceId, existingIssue.workspaceId),
          ),
        )

        return new Response(null, { status: 204 })
      },
    },
  },
})
