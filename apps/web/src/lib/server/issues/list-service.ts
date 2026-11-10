import { Result, type Result as ResultValue } from 'better-result'
import type { Issue } from '@garden/core/types/issue'
import {
  IssueServiceError,
  toIssue,
} from '@garden/server/issues/server'
import type { Db } from '@/lib/server/db'
import {
  listWorkspaceIssuesQuery,
  type ListWorkspaceIssuesQuery,
} from '@/lib/server/queries/issues'

export type ListWorkspaceIssuesPage = {
  issues: Issue[]
  total: number
}

/**
 * Lists issues for `GET /api/issues` as a `Result`.
 *
 * Before: the route ran Drizzle, mapped rows with `toIssue`, and built JSON
 * itself. After: the route authenticates, parses Zod, calls this service, and
 * maps `Result` → `Response`. SQL lives in `queries/issues`; DTO mapping stays
 * on `toIssue` from `@garden/server`. See
 * `docs/decisions/2026-11-09-api-layering.md`.
 */
export async function listWorkspaceIssues(
  db: Db,
  input: ListWorkspaceIssuesQuery,
): Promise<ResultValue<ListWorkspaceIssuesPage, IssueServiceError>> {
  return await Result.tryPromise({
    try: async () => {
      const page = await listWorkspaceIssuesQuery(db, input)
      return {
        issues: page.rows.map((row) =>
          toIssue(row, { issuePrefix: page.issuePrefix }),
        ),
        total: page.total,
      }
    },
    catch: (cause) =>
      new IssueServiceError({
        code: 'db_error',
        message: 'list issues failed',
        cause,
      }),
  })
}
