import { eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Loads raw `usage_json` blobs for every run on an issue. Aggregation stays in
 * the usage service so this query stays Drizzle-only.
 */
export async function listIssueRunUsageJson(db: Db, issueId: string) {
  return await db
    .select({ usageJson: schema.issueRun.usageJson })
    .from(schema.issueRun)
    .where(eq(schema.issueRun.issueId, issueId))
}
