import { and, desc, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Loads the issue's active run id and the newest pending permission request
 * for that run. Used by `GET /api/issues/$id/pending-approval`.
 */
export async function loadIssuePendingApprovalRows(
  db: Db,
  input: { workspaceId: string; issueId: string },
) {
  const [issue] = await db
    .select({ activeRunId: schema.issue.activeRunId })
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.id, input.issueId),
        eq(schema.issue.workspaceId, input.workspaceId),
      ),
    )
    .limit(1)

  const activeRunId = issue?.activeRunId
  if (activeRunId === null || activeRunId === undefined) {
    return { activeRunId: null, request: null } as const
  }

  const [request] = await db
    .select({
      id: schema.permissionRequest.id,
      context: schema.permissionRequest.context,
      kind: schema.permissionRequest.kind,
      argsJson: schema.permissionRequest.argsJson,
    })
    .from(schema.permissionRequest)
    .where(
      and(
        eq(schema.permissionRequest.runId, activeRunId),
        eq(schema.permissionRequest.status, 'pending'),
      ),
    )
    .orderBy(desc(schema.permissionRequest.requestedAt))
    .limit(1)

  return {
    activeRunId,
    request: request ?? null,
  } as const
}
