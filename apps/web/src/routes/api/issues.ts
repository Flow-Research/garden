import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  authorizeTeamIssueCreate,
  createIssue,
  type IssueServiceError,
} from '@garden/server/issues/server'
import { startIssueRun } from '@garden/server/issues/run-service'
import {
  createIssueBodySchema,
  issuesListSearchSchema,
  parseJsonBody,
  parseSearchParams,
} from '@/lib/server/validation/issues'
import { openIssuesCondition } from '@/lib/server/issue-list-filters'
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
import {
  isWorkspaceIssue,
  isWorkspaceParticipant,
} from '@/lib/server/workspace-refs'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  isWorkspaceManager,
  requireTeamAccess,
  teamError,
} from '@/lib/server/team-access'
import { teamIssueVisibilityCondition } from '@garden/db/team-issue-visibility'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'
import { createGardenLogger, errorFields } from '@garden/observability/logger'

const logger = createGardenLogger({
  service: 'garden-staging',
  component: 'issues-api',
})

/**
 * Maps issue-service create errors to the route's HTTP envelope. Team rule
 * denials keep the `ISSUE_TEAM_ACCESS_DENIED` 403 the UI keys off, and an
 * off-Team assignee stays a 400, exactly as the route answered when it owned
 * the rules inline; everything else uses `serviceErrorResponse`.
 */
function teamCreateErrorResponse(error: IssueServiceError) {
  if (error.code === 'team_access_denied') {
    return teamError(403, 'ISSUE_TEAM_ACCESS_DENIED', error.message)
  }
  if (error.code === 'team_not_found') {
    return teamError(404, 'TEAM_NOT_FOUND', error.message)
  }
  return serviceErrorResponse(error)
}

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
          has_team: hasTeam,
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
        // has_team filters team-assigned vs workspace-only issues in SQL so
        // cross-team lists never scan/return the full workspace issue set.
        if (hasTeam === true) conditions.push(isNotNull(schema.issue.teamId))
        if (hasTeam === false) conditions.push(isNull(schema.issue.teamId))
        if (status) conditions.push(eq(schema.issue.status, status))
        if (priority) conditions.push(eq(schema.issue.priority, priority))
        if (assigneeId) conditions.push(eq(schema.issue.assigneeId, assigneeId))
        if (assigneeIds && assigneeIds.length > 0) {
          conditions.push(inArray(schema.issue.assigneeId, assigneeIds))
        }
        if (creatorId) conditions.push(eq(schema.issue.createdBy, creatorId))
        if (openOnly) conditions.push(openIssuesCondition())

        const whereClause = and(...conditions)
        const [countRow] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(schema.issue)
          .where(whereClause)
        const count = countRow?.count ?? 0

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
          // Team-scoped create: normal Team members may create issues without
          // workspace issueManage. requireTeamAccess keeps the HTTP access
          // envelope (401/404/TEAM_ACCESS_DENIED); the Team create rules
          // themselves live in the issue service, and run here first so they
          // win over the generic assignee/parent checks below.
          const teamAccess = await requireTeamAccess(appContext, body.team_id)
          if (teamAccess instanceof Response) return teamAccess
          const teamRules = await authorizeTeamIssueCreate(db, {
            workspaceId,
            teamId: body.team_id,
            createdBy: session.user.id,
            assigneeType:
              typeof body.assignee_id === 'string'
                ? body.assignee_type === 'agent'
                  ? 'agent'
                  : 'user'
                : null,
            assigneeId: body.assignee_id ?? null,
          })
          if (teamRules.isErr()) return teamCreateErrorResponse(teamRules.error)
        } else {
          const managePermission = await requireWorkspacePermission({
            appContext,
            request,
            workspaceId,
            permissions: workspacePermissions.issueManage,
          })
          if (managePermission) return managePermission
        }

        if (body.assignee_id) {
          const assigneeInWorkspace = await isWorkspaceParticipant(
            db,
            workspaceId,
            {
              type: body.assignee_type === 'agent' ? 'agent' : 'member',
              id: body.assignee_id,
            },
          )
          if (!assigneeInWorkspace) {
            return badRequest('Assignee is not in this workspace')
          }
        }
        if (
          body.parent_issue_id &&
          !(await isWorkspaceIssue(db, workspaceId, body.parent_issue_id))
        ) {
          return badRequest('Parent issue is not in this workspace')
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
        if (issueResult.isErr())
          return teamCreateErrorResponse(issueResult.error)
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
          // waitUntil keeps the Worker alive until the run has started; a bare
          // floating promise can be cancelled once the response is sent.
          appContext.waitUntil(
            startIssueRun(appEnv, {
              workspaceId,
              issueId: issue.id,
              agentId: issue.assignee_id,
              source: 'assignment',
              actor: { type: 'member', id: session.user.id },
            }).then((startResult) => {
              if (startResult.isErr()) {
                logger.error(
                  'issue.run_start_failed',
                  errorFields(startResult.error),
                )
              }
            }),
          )
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
