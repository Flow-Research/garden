import { and, eq, inArray } from 'drizzle-orm'
import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { sendIssueAssignmentEmail } from '@/lib/server/email/issue-assignment'
import { LIVE_RUN_STATUSES } from '@garden/core/issues/run-sync'
import type { IssueStatus } from '@garden/core/types/issue'
import {
  archiveTerminalIssueInbox,
  upsertIssueAssignmentInbox,
} from '@garden/db/inbox'
import {
  addIssueSubscribers,
  assigneeToSubscriberType,
} from '@garden/db/subscribers'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  parseJsonBody,
  updateIssueBodySchema,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  getWorkspaceIssuePrefix,
  notFound,
  toIssue,
} from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { requireIssueAccess } from '@/lib/server/issue-access'
import {
  isWorkspaceManager,
  requireTeamAccess,
  teamError,
} from '@/lib/server/team-access'
import {
  cancelIssueRun,
  startIssueRun,
} from '@garden/server/issues/run-service'
import { cancelLiveRunsOnIssueChange } from '@garden/core/issues/run-sync'

export const Route = createFileRoute('/api/issues/$id')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const issuePrefix = await getWorkspaceIssuePrefix(
          access.db,
          access.issue.workspaceId,
        )
        return Response.json(toIssue(access.issue, { issuePrefix }))
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

        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const existingIssue = access.issue
        const db = access.db
        const session = access.session
        const isManager = access.isWorkspaceManager
        const isTeamOwner = access.isTeamOwner

        // Team issues are editable by the Team owner and Team members; workspace
        // issues keep the existing issueManage permission.
        const teamScoped = existingIssue.teamId !== null
        const privileged = isManager || (teamScoped && isTeamOwner)
        const canEdit = privileged || (teamScoped && access.teamMembership)
        if (!canEdit) {
          const permission = await requireWorkspacePermission({
            appContext,
            request,
            workspaceId: existingIssue.workspaceId,
            permissions: workspacePermissions.issueManage,
          })
          if (permission) return permission
        }

        const nextTeamId = Object.prototype.hasOwnProperty.call(body, 'team_id')
          ? (body.team_id ?? null)
          : existingIssue.teamId
        const teamChanged = nextTeamId !== existingIssue.teamId

        if (teamChanged) {
          if (!privileged && !isManager) {
            return teamError(
              403,
              'ISSUE_TEAM_ACCESS_DENIED',
              'Only workspace managers and Team owners can move issues between Teams',
            )
          }
          if (nextTeamId !== null) {
            const targetAccess = await requireTeamAccess(
              appContext,
              nextTeamId,
            )
            if (targetAccess instanceof Response) return targetAccess
            const targetManager = isWorkspaceManager(
              targetAccess.workspaceMembership.role,
            )
            const targetOwner =
              targetAccess.team.ownerUserId === session.user.id
            if (!(isManager || targetManager || targetOwner)) {
              return teamError(
                403,
                'ISSUE_TEAM_ACCESS_DENIED',
                'Team access denied for target Team',
              )
            }
          } else if (!(isManager || isTeamOwner)) {
            return teamError(
              403,
              'ISSUE_TEAM_ACCESS_DENIED',
              'Only workspace managers and the Team owner can move issues out of a Team',
            )
          }
        }

        if (!privileged) {
          if (Object.prototype.hasOwnProperty.call(body, 'assignee_id')) {
            if (
              body.assignee_type === 'agent' ||
              body.assignee_id !== session.user.id
            ) {
              return teamError(
                403,
                'ISSUE_TEAM_ACCESS_DENIED',
                'Team members can only assign issues to themselves',
              )
            }
          }
        }

        const assigneeFieldPresent = Object.prototype.hasOwnProperty.call(
          body,
          'assignee_id',
        )
        const resultingAssigneeId = assigneeFieldPresent
          ? (body.assignee_id ?? null)
          : existingIssue.assigneeId
        if (nextTeamId !== null && (teamChanged || assigneeFieldPresent)) {
          if (!resultingAssigneeId) {
            return badRequest('Team issues must be assigned to a Team member')
          }
          const resultingAssigneeType =
            assigneeFieldPresent && typeof body.assignee_id === 'string'
              ? body.assignee_type === 'agent'
                ? 'agent'
                : 'user'
              : existingIssue.assigneeType
          const assigneeCondition =
            resultingAssigneeType === 'agent'
              ? and(
                  eq(schema.teamMember.teamId, nextTeamId),
                  eq(schema.teamMember.agentId, resultingAssigneeId),
                )
              : and(
                  eq(schema.teamMember.teamId, nextTeamId),
                  eq(schema.teamMember.userId, resultingAssigneeId),
                )
          const [assigneeMembership] = await db
            .select({ id: schema.teamMember.id })
            .from(schema.teamMember)
            .where(assigneeCondition)
          if (!assigneeMembership) {
            return badRequest('Assignee must be a Team member')
          }
        }

        const updateValues: Partial<typeof schema.issue.$inferInsert> = {}

        if (typeof body.title === 'string') updateValues.title = body.title
        if (Object.prototype.hasOwnProperty.call(body, 'description')) {
          updateValues.description = body.description ?? null
        }
        if (body.status) updateValues.status = body.status
        if (body.priority) updateValues.priority = body.priority
        if (typeof body.position === 'number')
          updateValues.position = body.position
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
        if (Object.prototype.hasOwnProperty.call(body, 'team_id')) {
          updateValues.teamId = nextTeamId
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

        // Assigning (member or agent) durably joins them to the issue so they
        // appear in the participants panel. Idempotent + best-effort; the
        // assignment write above is the source of truth.
        const assigneeChanged =
          existingIssue.assigneeType !== issue.assigneeType ||
          existingIssue.assigneeId !== issue.assigneeId
        const newAssigneeType = assigneeToSubscriberType(issue.assigneeType)
        if (assigneeChanged && newAssigneeType && issue.assigneeId) {
          // Best-effort per the note above: the assignment write is the source of
          // truth, so a participants-join failure (e.g. a not-yet-applied
          // issue_subscriber migration) must not 500 the assignment or skip the
          // downstream inbox + assignment email.
          const assigneeId = issue.assigneeId
          const subscriberResult = await Result.tryPromise({
            try: () =>
              addIssueSubscribers(db, {
                workspaceId: existingIssue.workspaceId,
                issueId: issue.id,
                entries: [
                  {
                    userType: newAssigneeType,
                    userId: assigneeId,
                    reason: 'assignee',
                  },
                ],
              }),
            catch: (cause) => cause,
          })
          if (subscriberResult.isErr())
            console.error('issue_subscriber_add_failed', subscriberResult.error)
        }

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
            actorId: session.user.id,
          })

          // Out-of-app nudge for the new assignee. Skip self-assignment (no
          // point emailing yourself) and keep it best-effort so a Resend failure
          // never fails the assignment write.
          if (issue.assigneeId !== session.user.id) {
            const [assignee] = await db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, issue.assigneeId))
            const [workspace] = await db
              .select({ name: schema.organization.name })
              .from(schema.organization)
              .where(eq(schema.organization.id, existingIssue.workspaceId))

            if (assignee?.email) {
              const assignerName =
                session.user.name?.trim() || session.user.email
              const emailResult = await Result.tryPromise({
                try: () =>
                  sendIssueAssignmentEmail({
                    baseURL:
                      appEnv.BETTER_AUTH_URL ?? new URL(request.url).origin,
                    data: {
                      issue: { id: issue.id, title: issue.title },
                      workspace: {
                        id: existingIssue.workspaceId,
                        name: workspace?.name ?? 'your workspace',
                      },
                      assignee: { email: assignee.email },
                      assignerName,
                    },
                    env: appEnv,
                  }),
                catch: (cause) => cause,
              })
              if (emailResult.isErr())
                console.error(
                  'issue_assignment_email_failed',
                  emailResult.error,
                )
            }
          }
        }
        if (issue.status === 'done' || issue.status === 'cancelled') {
          await archiveTerminalIssueInbox({
            db,
            workspaceId: existingIssue.workspaceId,
            issueId: issue.id,
          })
        }
        const syncDecision = cancelLiveRunsOnIssueChange({
          currentStatus: (existingIssue.status ?? 'todo') as IssueStatus,
          nextStatus: (issue.status ?? 'todo') as IssueStatus,
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
              actor: { type: 'member', id: session.user.id },
              reason: 'issue_changed',
            })
            if (cancelResult.isErr()) console.error(cancelResult.error.message)
          }
        }

        if (syncDecision.shouldWakeAgent && issue.assigneeId) {
          const startResult = await startIssueRun(appEnv, {
            workspaceId: existingIssue.workspaceId,
            issueId: issue.id,
            agentId: issue.assigneeId,
            source: 'assignment',
            actor: { type: 'member', id: session.user.id },
          })
          if (startResult.isErr()) console.error(startResult.error.message)
        }
        return Response.json(
          toIssue(issue, {
            issuePrefix: await getWorkspaceIssuePrefix(
              db,
              existingIssue.workspaceId,
            ),
          }),
        )
      },
      DELETE: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId: access.issue.workspaceId,
          permissions: workspacePermissions.issueManage,
        })
        if (permission) return permission

        await access.db
          .delete(schema.issue)
          .where(
            and(
              eq(schema.issue.id, params.id),
              eq(schema.issue.workspaceId, access.issue.workspaceId),
            ),
          )

        return new Response(null, { status: 204 })
      },
    },
  },
})
