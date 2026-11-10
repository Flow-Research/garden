import { Result, type Result as ResultValue } from 'better-result'
import {
  IssueServiceError,
} from '@garden/server/issues/server'
import type { Db } from '@/lib/server/db'
import { listIssueRunUsageJson } from '@/lib/server/queries/issues'

export type IssueUsageTotals = {
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_write_tokens: number
  task_count: number
}

function numericUsage(usage: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

/**
 * Aggregates token usage across an issue's runs for `GET /api/issues/$id/usage`.
 */
export async function getIssueUsageTotals(
  db: Db,
  issueId: string,
): Promise<ResultValue<IssueUsageTotals, IssueServiceError>> {
  return await Result.tryPromise({
    try: async () => {
      const runs = await listIssueRunUsageJson(db, issueId)
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let totalCacheReadTokens = 0
      let totalCacheWriteTokens = 0
      let taskCount = 0

      for (const run of runs) {
        const usage =
          run.usageJson &&
          typeof run.usageJson === 'object' &&
          !Array.isArray(run.usageJson)
            ? (run.usageJson as Record<string, unknown>)
            : null
        if (!usage) continue

        taskCount += 1
        totalInputTokens += numericUsage(usage, ['input_tokens'])
        totalOutputTokens += numericUsage(usage, ['output_tokens'])
        totalCacheReadTokens += numericUsage(usage, [
          'cached_input_tokens',
          'cache_read_tokens',
        ])
        totalCacheWriteTokens += numericUsage(usage, [
          'cache_write_tokens',
          'cache_creation_input_tokens',
        ])
      }

      return {
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_cache_read_tokens: totalCacheReadTokens,
        total_cache_write_tokens: totalCacheWriteTokens,
        task_count: taskCount,
      }
    },
    catch: (cause) =>
      new IssueServiceError({
        code: 'db_error',
        message: 'list issue usage failed',
        cause,
      }),
  })
}
