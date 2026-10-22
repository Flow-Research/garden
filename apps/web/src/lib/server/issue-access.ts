import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { AppRequestContext } from '@/lib/server/context'
import { getDb, schema, type Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { forbidden, notFound, requireSession, unauthorized } from './control-plane'
import { isWorkspaceManager, teamError } from './team-access'

type RequestBoundary = Request | AppRequestContext

async function dbFor(input: RequestBoundary): Promise<Db> {
  return input instanceof Request ? getDb(appEnv) : input.db()
}

export interface IssueAccess {
  session: NonNullable<Awaited<ReturnType<typeof requireSession>>>
  db: Db
  issue: typeof schema.issue.$inferSelect
  workspaceMembership: { organizationId: string; role: string }
  team: typeof schema.team.$inferSelect | null
  teamMembership: typeof schema.teamMember.$inferSelect | null
  isWorkspaceManager: boolean
  isTeamOwner: boolean
}

/**
 * The single authorization boundary for issue reads and writes.
 *
 * Workspace issues keep the existing rule: any workspace member may read.
 * Team issues are visible only to workspace owners/admins, the Team owner, or
 * a Team member assigned to that issue (P0: normal members see assigned work
 * only). Returns 401 without a session, 404 for a missing issue, 403 when the
 * issue exists but the caller cannot reach it.
 */
export async function requireIssueAccess(
  input: RequestBoundary,
  issueId: string,
): Promise<IssueAccess | Response> {
  const session = await requireSession(input)
  if (!session) return unauthorized()

  const db = await dbFor(input)
  const [issue] = await db
    .select()
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId))
  if (!issue) return notFound('Issue not found')

  const [workspaceMembership] = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, issue.workspaceId),
        eq(schema.member.userId, session.user.id),
      ),
    )
  if (!workspaceMembership) {
    return forbidden('Workspace access denied')
  }

  const manager = isWorkspaceManager(workspaceMembership.role)
  if (!issue.teamId) {
    return {
      session,
      db,
      issue,
      workspaceMembership,
      team: null,
      teamMembership: null,
      isWorkspaceManager: manager,
      isTeamOwner: false,
    }
  }

  const [team] = await db
    .select()
    .from(schema.team)
    .where(eq(schema.team.id, issue.teamId))
  if (!team) return notFound('Issue not found')

  const [teamMembership] = await db
    .select()
    .from(schema.teamMember)
    .where(
      and(
        eq(schema.teamMember.teamId, team.id),
        eq(schema.teamMember.userId, session.user.id),
      ),
    )

  const isTeamOwner = team.ownerUserId === session.user.id
  const assignedToCaller =
    issue.assigneeType === 'user' && issue.assigneeId === session.user.id
  const visible =
    manager || isTeamOwner || (Boolean(teamMembership) && assignedToCaller)
  if (!visible) {
    return teamError(403, 'ISSUE_TEAM_ACCESS_DENIED', 'Issue access denied')
  }

  return {
    session,
    db,
    issue,
    workspaceMembership,
    team,
    teamMembership: teamMembership ?? null,
    isWorkspaceManager: manager,
    isTeamOwner,
  }
}

/**
 * SQL predicate that keeps collection queries (list, search, child progress)
 * aligned with direct issue access. Workspace issues stay visible; Team issues
 * are visible only to managers, the Team owner, or the assigned Team member.
 * Callers must still constrain `workspace_id`.
 */
export function teamIssueVisibilityCondition(args: {
  viewerId: string
  manager: boolean
}): SQL {
  if (args.manager) return sql`true`
  return sql`("issue"."team_id" is null
    or exists (select 1 from "team" t where t.id = "issue"."team_id" and t.owner_user_id = ${args.viewerId})
    or (exists (select 1 from "team_member" tm where tm.team_id = "issue"."team_id" and tm.user_id = ${args.viewerId})
        and "issue"."assignee_type" = 'user'
        and "issue"."assignee_id" = ${args.viewerId}))`
}
