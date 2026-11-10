import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
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
import { isTeamAssigneeMember } from '@/lib/server/queries/issues'
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
 */
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
          const assigneeIsTeamMember = await isTeamAssigneeMember(db, {
            teamId: body.team_id,
            assigneeId: body.assignee_id,
            assigneeType: body.assignee_type,
          })
          if (!assigneeIsTeamMember) {
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
        if (issueResult.isErr()) return serviceErrorResponse(issueResult.error)
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
