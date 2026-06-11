import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'

function numericUsage(usage: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

export const Route = createFileRoute('/api/issues/$id/usage')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {

        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(appContext, issue.workspaceId)
        if (access instanceof Response) return access

        const runs = await db
          .select({ usageJson: schema.issueRun.usageJson })
          .from(schema.issueRun)
          .where(eq(schema.issueRun.issueId, params.id))

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

        return Response.json({
          total_input_tokens: totalInputTokens,
          total_output_tokens: totalOutputTokens,
          total_cache_read_tokens: totalCacheReadTokens,
          total_cache_write_tokens: totalCacheWriteTokens,
          task_count: taskCount,
        })
      },
    },
  },
})
