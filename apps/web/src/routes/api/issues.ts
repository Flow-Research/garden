import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
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
import {
  badRequest,
  requireWorkspaceAccess,
  requireWorkspaceContext,
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
import { listWorkspaceIssues } from '@/lib/server/issues/list-service'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'
import { createGardenLogger, errorFields } from '@garden/observability/logger'

const logger = createGardenLogger({
  service: 'garden-staging',
  component: 'issues-api',
})

/**
 * `/api/issues` reference route for API layering: auth + Zod here, list/create
 * through services/queries, no `drizzle-orm` / `@/lib/server/db` imports.
 * See `docs/decisions/2026-11-09-api-layering.md`.
 *
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
        const listResult = await listWorkspaceIssues(db, {
          workspaceId,
          viewerId: session.user.id,
          manager: isWorkspaceManager(workspaceAccess.membership.role),
          teamId,
          hasTeam,
          status,
          priority,
          assigneeId,
          assigneeIds,
          creatorId,
          openOnly,
          limit,
          offset,
        })
        return listResult.match({
          ok: (page) => Response.json(page),
          err: (error) => serviceErrorResponse(error),
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
          // Team create rules live in the issue service (`authorizeTeamIssueCreate`);
          // run them here first so they win over the generic assignee/parent checks below.
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
