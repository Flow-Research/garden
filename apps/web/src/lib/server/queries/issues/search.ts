import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { teamIssueVisibilityCondition } from '@garden/db/team-issue-visibility'
import { schema, type Db } from '@/lib/server/db'

export type SearchWorkspaceIssuesQuery = {
  workspaceId: string
  viewerId: string
  manager: boolean
  searchTerms: string[]
  includeClosed: boolean
}

/**
 * Searches workspace issues by title/description/identifier and by comment
 * body. Returns dedupe-ready issue rows plus the workspace issue prefix.
 */
export async function searchWorkspaceIssuesQuery(
  db: Db,
  input: SearchWorkspaceIssuesQuery,
) {
  const visibility = teamIssueVisibilityCondition({
    viewerId: input.viewerId,
    manager: input.manager,
  })
  const [workspace] = await db
    .select({ issuePrefix: schema.organization.issuePrefix })
    .from(schema.organization)
    .where(eq(schema.organization.id, input.workspaceId))
    .limit(1)
  const issuePrefix = workspace?.issuePrefix ?? 'ISS'
  // The prefix arrives as a bound parameter, so Postgres cannot infer a
  // type for it inside concat() and rejects the whole statement with
  // 42P18 (indeterminate datatype). Casting the parameter keeps the
  // identifier search working without inlining user-controlled text.
  const issueWhere = and(
    eq(schema.issue.workspaceId, input.workspaceId),
    visibility,
    input.includeClosed ? undefined : sql`${schema.issue.status} <> 'done'`,
    ...input.searchTerms.map((term) =>
      or(
        ilike(schema.issue.title, `%${term}%`),
        ilike(schema.issue.description, `%${term}%`),
        sql`concat(${issuePrefix}::text, '-', ${schema.issue.number}::text) ilike ${`%${term}%`}`,
      ),
    ),
  )

  const commentMatches = await db
    .select({ issueId: schema.issueComment.issueId })
    .from(schema.issueComment)
    .innerJoin(schema.issue, eq(schema.issue.id, schema.issueComment.issueId))
    .where(
      and(
        eq(schema.issue.workspaceId, input.workspaceId),
        visibility,
        input.includeClosed ? undefined : sql`${schema.issue.status} <> 'done'`,
        ...input.searchTerms.map((term) =>
          ilike(schema.issueComment.body, `%${term}%`),
        ),
      ),
    )

  const commentIssueIds = Array.from(
    new Set(commentMatches.map((match) => match.issueId)),
  )

  const issueRows = await db
    .select()
    .from(schema.issue)
    .where(issueWhere)
    .orderBy(desc(schema.issue.updatedAt), desc(schema.issue.createdAt))

  const commentRows =
    commentIssueIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.issue)
          .where(
            and(
              eq(schema.issue.workspaceId, input.workspaceId),
              inArray(schema.issue.id, commentIssueIds),
            ),
          )
          .orderBy(desc(schema.issue.updatedAt), desc(schema.issue.createdAt))

  return { issueRows, commentRows, issuePrefix }
}
