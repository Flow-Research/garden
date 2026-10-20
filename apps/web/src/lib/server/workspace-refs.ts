import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

export type WorkspaceParticipant = {
  type: 'member' | 'agent'
  id: string
}

/**
 * True when the member or agent belongs to the workspace. Call this before
 * storing any participant ID taken from a request body: IDs are global, so
 * without it a caller can point workspace data at users or agents elsewhere.
 */
export async function isWorkspaceParticipant(
  db: Db,
  workspaceId: string,
  participant: WorkspaceParticipant,
) {
  if (participant.type === 'agent') {
    const [row] = await db
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(
        and(
          eq(schema.agent.id, participant.id),
          eq(schema.agent.workspaceId, workspaceId),
        ),
      )
      .limit(1)
    return Boolean(row)
  }

  const [row] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, participant.id),
        eq(schema.member.organizationId, workspaceId),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** True when the issue exists in the workspace. */
export async function isWorkspaceIssue(
  db: Db,
  workspaceId: string,
  issueId: string,
) {
  const [row] = await db
    .select({ id: schema.issue.id })
    .from(schema.issue)
    .where(
      and(eq(schema.issue.id, issueId), eq(schema.issue.workspaceId, workspaceId)),
    )
    .limit(1)
  return Boolean(row)
}
