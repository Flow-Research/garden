import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { createIssue } from '@garden/server/issues/server'
import { startIssueRun } from '@garden/server/issues/run-service'
import {
  createIssueBodySchema,
  issuesListSearchSchema,
  parseJsonBody,
  parseSearchParams,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  getWorkspaceIssuePrefix,
  requireWorkspaceAccess,
  requireWorkspaceContext,
  toIssue,
} from '@/lib/server/control-plane'
import { publishWorkspaceEvent } from '@/lib/server/realtime'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { isWorkspaceManager, requireTeamAccess, teamError } from '@/lib/server/team-access'
import { teamIssueVisibilityCondition } from '@/lib/server/issue-access'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'

export const Route = createFileRoute('/api/issues')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext, {
          missingWorkspaceResponse: () =>
            Response.json({ issues: [], total: 0 }),
        })
        if (workspaceContext instanceof Response) return workspaceContext
        const { session, workspaceId } = workspaceContext
        const workspaceAccess = await requireWorkspaceAccess(
          appContext,
          workspaceId,
        )
        if (workspaceAccess instanceof Response) return workspaceAccess
        const searchResult = parseSearchParams(
          request,
          issuesListSearchSchema,
          'Invalid issue query',
        )
        if (searchResult.isErr()) return badRequest(searchResult.error.message)

        const {
          assignee_id: assigneeId,
          assignee_ids: assigneeIds,
          creator_id: creatorId,
          limit,
          offset,
          open_only: openOnly = false,
          priority,
          status,
          team_id: teamId,
        } = searchResult.value
        const db = await appContext.db()

        const conditions = [
          eq(schema.issue.workspaceId, workspaceId),
          teamIssueVisibilityCondition({
            viewerId: session.user.id,
            manager: isWorkspaceManager(workspaceAccess.membership.role),
          }),
        ]
        if (teamId) conditions.push(eq(schema.issue.teamId, teamId))
        if (status) conditions.push(eq(schema.issue.status, status))
        if (priority) conditions.push(eq(schema.issue.priority, priority))
        if (assigneeId) conditions.push(eq(schema.issue.assigneeId, assigneeId))
        if (assigneeIds && assigneeIds.length > 0) {
          conditions.push(inArray(schema.issue.assigneeId, assigneeIds))
        }
        if (creatorId) conditions.push(eq(schema.issue.createdBy, creatorId))
        if (openOnly) conditions.push(sql`${schema.issue.status} <> 'done'`)

        const whereClause = and(...conditions)
        const [{ count }] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(schema.issue)
          .where(whereClause)

        const query = db
          .select()
          .from(schema.issue)
          .where(whereClause)
          .orderBy(
            desc(schema.issue.updatedAt),
            desc(schema.issue.createdAt),
            desc(schema.issue.number),
          )

        const limitValue = typeof limit === 'number' ? limit : null
        const offsetValue = typeof offset === 'number' ? offset : 0
        const safeLimit =
          limitValue !== null && Number.isFinite(limitValue) && limitValue > 0
            ? limitValue
            : null
        const safeOffset =
          Number.isFinite(offsetValue) && offsetValue > 0 ? offsetValue : 0
        const rows = await (safeLimit !== null
          ? query.limit(safeLimit).offset(safeOffset)
          : query.offset(safeOffset))
        const issuePrefix = await getWorkspaceIssuePrefix(db, workspaceId)

        return Response.json({
          issues: rows.map((row) => toIssue(row, { issuePrefix })),
          total: count,
        })
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext
        const { session, workspaceId } = workspaceContext
        const bodyResult = await parseJsonBody(
          request,
          createIssueBodySchema,
          'Invalid issue payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const db = await appContext.db()

        if (typeof body.team_id === 'string') {
          // Team-scoped create: normal Team members may create issues even
          // though they lack the workspace issueManage permission, as long as
          // the issue is assigned to themselves and the assignee is a Team
          // member. Workspace managers and the Team owner may assign others.
          const teamAccess = await requireTeamAccess(appContext, body.team_id)
          if (teamAccess instanceof Response) return teamAccess
          const manager = isWorkspaceManager(
            teamAccess.workspaceMembership.role,
          )
          const canAssignOthers =
            manager || teamAccess.team.ownerUserId === session.user.id
          if (!manager && !teamAccess.teamMembership) {
            return teamError(
              403,
              'ISSUE_TEAM_ACCESS_DENIED',
              'Team membership required',
            )
          }
          if (typeof body.assignee_id !== 'string') {
            return badRequest('Team issues must be assigned to a Team member')
          }
          if (
            !canAssignOthers &&
            (body.assignee_type === 'agent' ||
              body.assignee_id !== session.user.id)
          ) {
            return teamError(
              403,
              'ISSUE_TEAM_ACCESS_DENIED',
              'Team members can only assign issues to themselves',
            )
          }
          const assigneeCondition =
            body.assignee_type === 'agent'
              ? and(
                  eq(schema.teamMember.teamId, body.team_id),
                  eq(schema.teamMember.agentId, body.assignee_id),
                )
              : and(
                  eq(schema.teamMember.teamId, body.team_id),
                  eq(schema.teamMember.userId, body.assignee_id),
                )
          const [assigneeMembership] = await db
            .select({ id: schema.teamMember.id })
            .from(schema.teamMember)
            .where(assigneeCondition)
          if (!assigneeMembership) {
            return badRequest('Assignee must be a Team member')
          }
        } else {
          const managePermission = await requireWorkspacePermission({
            appContext,
            request,
            workspaceId,
            permissions: workspacePermissions.issueManage,
          })
          if (managePermission) return managePermission
        }

        const issueResult = await createIssue({
          databaseUrl: appEnv.HYPERDRIVE.connectionString,
          workspaceId,
          title: body.title,
          description:
            typeof body.description === 'string' ? body.description : null,
          status: body.status ?? 'todo',
          priority: body.priority ?? 'medium',
          createdBy: session.user.id,
          assigneeType:
            typeof body.assignee_id === 'string'
              ? body.assignee_type === 'agent'
                ? 'agent'
                : 'user'
              : null,
          assigneeId: body.assignee_id ?? null,
          teamId: body.team_id ?? null,
          parentId: body.parent_issue_id ?? null,
          projectId: body.project_id ?? null,
          dueDate: body.due_date ? new Date(body.due_date) : null,
          attachmentIds: body.attachment_ids,
        })
        if (issueResult.isErr()) return badRequest(issueResult.error.message)
        const issue = issueResult.value
        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, workspaceId, {
            type: 'issue:created',
            payload: { issue },
          }),
        )
        if (
          body.auto_start !== false &&
          issue.assignee_type === 'agent' &&
          issue.assignee_id &&
          issue.status !== 'todo' &&
          issue.status !== 'blocked' &&
          issue.status !== 'done' &&
          issue.status !== 'cancelled'
        ) {
          void startIssueRun(appEnv, {
            workspaceId,
            issueId: issue.id,
            agentId: issue.assignee_id,
            source: 'assignment',
            actor: { type: 'member', id: session.user.id },
          }).then((startResult) => {
            if (startResult.isErr()) console.error(startResult.error.message)
          })
        }
        capturePostHogEvent(appContext, {
          distinctId: session.user.id,
          event: GARDEN_ANALYTICS_EVENTS.issueCreated,
          workspaceId,
          properties: {
            issue_id: issue.id,
            status: issue.status,
            priority: issue.priority,
            assignee_type: issue.assignee_type,
            has_parent: !!body.parent_issue_id,
            auto_started: !!(
              body.auto_start !== false &&
              issue.assignee_type === 'agent' &&
              issue.assignee_id &&
              issue.status !== 'todo' &&
              issue.status !== 'blocked' &&
              issue.status !== 'done' &&
              issue.status !== 'cancelled'
            ),
          },
        })
        return Response.json(issue, { status: 201 })
      },
    },
  },
})
