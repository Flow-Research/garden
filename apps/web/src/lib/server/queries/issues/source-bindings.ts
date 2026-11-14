import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Loads the workspace id for an issue source binding, or null when the
 * binding is missing or not on that issue.
 */
export async function getIssueSourceBindingWorkspaceId(
  db: Db,
  input: { issueId: string; bindingId: string },
): Promise<string | null> {
  const [binding] = await db
    .select({ workspaceId: schema.issueSourceBinding.workspaceId })
    .from(schema.issueSourceBinding)
    .where(
      and(
        eq(schema.issueSourceBinding.id, input.bindingId),
        eq(schema.issueSourceBinding.issueId, input.issueId),
      ),
    )
    .limit(1)
  return binding?.workspaceId ?? null
}
