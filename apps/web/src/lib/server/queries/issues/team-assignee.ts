import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * True when the user or agent is a member of the Team. Used by
 * `PUT /api/issues/$id` when changing a Team issue assignee so the new
 * assignee cannot sit outside the Team.
 *
 * Before: the issue `$id` route selected `team_member` inline with Drizzle.
 * After: the route calls this query helper so it stays free of `drizzle-orm`.
 * Team create authorization for `POST /api/issues` lives in
 * `authorizeTeamIssueCreate` (`@garden/server/issues/server`).
 */
export async function isTeamAssigneeMember(
  db: Db,
  input: {
    teamId: string
    assigneeId: string
    assigneeType: 'member' | 'agent' | null | undefined
  },
): Promise<boolean> {
  const assigneeCondition =
    input.assigneeType === 'agent'
      ? and(
          eq(schema.teamMember.teamId, input.teamId),
          eq(schema.teamMember.agentId, input.assigneeId),
        )
      : and(
          eq(schema.teamMember.teamId, input.teamId),
          eq(schema.teamMember.userId, input.assigneeId),
        )
  const [assigneeMembership] = await db
    .select({ id: schema.teamMember.id })
    .from(schema.teamMember)
    .where(assigneeCondition)
  return Boolean(assigneeMembership)
}
