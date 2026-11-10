import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { teamIssueVisibilityCondition } from '@garden/db/team-issue-visibility'
import type { Issue } from '@garden/core/types/issue'
import { schema, type Db } from '@/lib/server/db'

/**
 * Filters for the workspace issue board/list API. Auth and Zod already ran in
 * the route; this query only builds SQL.
 */
export type ListWorkspaceIssuesQuery = {
  workspaceId: string
  viewerId: string
  manager: boolean
  teamId?: string
  hasTeam?: boolean
  status?: Issue['status']
  priority?: Issue['priority']
  assigneeId?: string
  assigneeIds?: string[]
  creatorId?: string
  openOnly?: boolean
  limit?: number
  offset?: number
}

export type ListWorkspaceIssuesResult = {
  rows: Array<typeof schema.issue.$inferSelect>
  total: number
  issuePrefix: string
}

/**
 * Lists workspace issues the viewer may see, with count and issue prefix.
 *
 * Before: `GET /api/issues` built this Drizzle query inline in the route.
 * After: routes call this (via the list service) so handlers stay free of
 * `drizzle-orm` / `@garden/db` imports — see
 * `docs/decisions/2026-11-09-api-layering.md`.
 */
export async function listWorkspaceIssuesQuery(
  db: Db,
  input: ListWorkspaceIssuesQuery,
): Promise<ListWorkspaceIssuesResult> {
  const conditions = [
    eq(schema.issue.workspaceId, input.workspaceId),
    teamIssueVisibilityCondition({
      viewerId: input.viewerId,
      manager: input.manager,
    }),
  ]
  if (input.teamId) conditions.push(eq(schema.issue.teamId, input.teamId))
  // hasTeam filters team-assigned vs workspace-only issues in SQL so
  // cross-team lists never scan/return the full workspace issue set.
  if (input.hasTeam === true) conditions.push(isNotNull(schema.issue.teamId))
  if (input.hasTeam === false) conditions.push(isNull(schema.issue.teamId))
  if (input.status) conditions.push(eq(schema.issue.status, input.status))
  if (input.priority) conditions.push(eq(schema.issue.priority, input.priority))
  if (input.assigneeId) {
    conditions.push(eq(schema.issue.assigneeId, input.assigneeId))
  }
  if (input.assigneeIds && input.assigneeIds.length > 0) {
    conditions.push(inArray(schema.issue.assigneeId, input.assigneeIds))
  }
  if (input.creatorId) {
    conditions.push(eq(schema.issue.createdBy, input.creatorId))
  }
  if (input.openOnly) {
    conditions.push(sql`${schema.issue.status} <> 'done'`)
  }

  const whereClause = and(...conditions)
  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.issue)
    .where(whereClause)
  const total = countRow?.count ?? 0

  const query = db
    .select()
    .from(schema.issue)
    .where(whereClause)
    .orderBy(
      desc(schema.issue.updatedAt),
      desc(schema.issue.createdAt),
      desc(schema.issue.number),
    )

  const limitValue = typeof input.limit === 'number' ? input.limit : null
  const offsetValue = typeof input.offset === 'number' ? input.offset : 0
  const safeLimit =
    limitValue !== null && Number.isFinite(limitValue) && limitValue > 0
      ? limitValue
      : null
  const safeOffset =
    Number.isFinite(offsetValue) && offsetValue > 0 ? offsetValue : 0
  const rows = await (safeLimit !== null
    ? query.limit(safeLimit).offset(safeOffset)
    : query.offset(safeOffset))

  const [org] = await db
    .select({ issuePrefix: schema.organization.issuePrefix })
    .from(schema.organization)
    .where(eq(schema.organization.id, input.workspaceId))
    .limit(1)
  const issuePrefix =
    org && typeof org.issuePrefix === 'string' && org.issuePrefix
      ? org.issuePrefix
      : 'ISS'

  return { rows, total, issuePrefix }
}
