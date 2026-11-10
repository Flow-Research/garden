import { Result, type Result as ResultValue } from 'better-result'
import type { Issue } from '@garden/core/types/issue'
import {
  IssueServiceError,
  toIssue,
} from '@garden/server/issues/server'
import type { Db } from '@/lib/server/db'
import {
  searchWorkspaceIssuesQuery,
  type SearchWorkspaceIssuesQuery,
} from '@/lib/server/queries/issues'

export type SearchedIssue = Issue & {
  match_source: 'title' | 'description' | 'comment'
  matched_snippet?: string
}

export type SearchWorkspaceIssuesPage = {
  issues: SearchedIssue[]
  total: number
}

/**
 * Searches workspace issues and ranks title/description/comment hits for
 * `GET /api/issues/search`.
 */
export async function searchWorkspaceIssues(
  db: Db,
  input: SearchWorkspaceIssuesQuery & { limit: number; offset: number },
): Promise<ResultValue<SearchWorkspaceIssuesPage, IssueServiceError>> {
  return await Result.tryPromise({
    try: async () => {
      const { issueRows, commentRows, issuePrefix } =
        await searchWorkspaceIssuesQuery(db, input)
      const seen = new Set<string>()
      const results = [...issueRows, ...commentRows]
        .filter((issue) => {
          if (seen.has(issue.id)) return false
          seen.add(issue.id)
          return true
        })
        .map((issue) => {
          const baseIssue = toIssue(issue, { issuePrefix })
          const title = issue.title.toLocaleLowerCase()
          const description = issue.description?.toLocaleLowerCase()
          const titleHit = input.searchTerms.every((term) =>
            title.includes(term),
          )
          const descriptionHit = input.searchTerms.every((term) =>
            description?.includes(term),
          )

          return {
            ...baseIssue,
            match_source: titleHit
              ? ('title' as const)
              : descriptionHit
                ? ('description' as const)
                : ('comment' as const),
            matched_snippet: issue.description?.slice(0, 180) ?? undefined,
          }
        })

      return {
        issues: results.slice(input.offset, input.offset + input.limit),
        total: results.length,
      }
    },
    catch: (cause) =>
      new IssueServiceError({
        code: 'db_error',
        message: 'search issues failed',
        cause,
      }),
  })
}
