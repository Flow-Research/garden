import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { teamIssueVisibilityCondition } from '@garden/db/team-issue-visibility'
import { schema, type Db } from '@/lib/server/db'

/**
 * Counts visible child issues per parent for the workspace board progress UI.
 */
export async function listChildIssueProgress(
  db: Db,
  input: { workspaceId: string; viewerId: string; manager: boolean },
) {
  return await db
    .select({
      parentId: schema.issue.parentId,
      total: sql<number>`cast(count(*) as int)`,
      done: sql<number>`cast(count(*) filter (where ${schema.issue.status} = 'done') as int)`,
    })
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.workspaceId, input.workspaceId),
        isNotNull(schema.issue.parentId),
        teamIssueVisibilityCondition({
          viewerId: input.viewerId,
          manager: input.manager,
        }),
      ),
    )
    .groupBy(schema.issue.parentId)
}
