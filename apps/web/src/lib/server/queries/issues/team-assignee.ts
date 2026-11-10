import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * True when the user or agent is a member of the Team. Used by issue create
 * before writing a team-scoped issue so assignees cannot be pointed outside
 * the Team.
 *
 * Before: `POST /api/issues` selected `team_member` inline with Drizzle.
 * After: the route calls this query helper so it stays free of `drizzle-orm`.
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
