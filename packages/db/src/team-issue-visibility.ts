import { sql, type SQL } from 'drizzle-orm'

/** Workspace owners and admins manage every Team and see every Team issue. */
export function isWorkspaceManagerRole(
  role: string | null | undefined,
): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Who may read a Team issue. Workspace owners and admins see every Team
 * issue; anyone with a `team_member` row sees the whole Team board.
 *
 * Before this rule, a normal member saw only the Team issues assigned to them,
 * so a Team board imported from GitHub looked empty to most engineers. The
 * product decision (Teams feature doc) is that Team membership grants the
 * board. The Team owner needs no separate term: Team creation inserts the
 * owner as a member, ownership transfer requires an existing member, and the
 * owner cannot be removed (`apps/web/src/lib/server/teams.ts`).
 *
 * This is the in-memory form for a single issue or realtime event. Collection
 * queries use `teamIssueVisibilityCondition`, which encodes the same rule.
 */
export function canViewTeamIssue(viewer: {
  manager: boolean
  teamMember: boolean
}): boolean {
  return viewer.manager || viewer.teamMember
}

/**
 * SQL form of `canViewTeamIssue` for collection queries over `issue` (list,
 * search, child progress, agent `list_issues`). Workspace issues
 * (`team_id is null`) stay visible to every workspace member. Callers must
 * still constrain `issue.workspace_id`.
 */
export function teamIssueVisibilityCondition(args: {
  viewerId: string
  manager: boolean
}): SQL {
  if (args.manager) return sql`true`
  return sql`("issue"."team_id" is null
    or exists (select 1 from "team_member" tm where tm.team_id = "issue"."team_id" and tm.user_id = ${args.viewerId}))`
}
