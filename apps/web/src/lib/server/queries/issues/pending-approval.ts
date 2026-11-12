import { and, desc, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Loads the newest pending permission request for an issue run.
 *
 * Callers that already resolved the issue via `requireIssueAccess` pass
 * `activeRunId` so this stays a single query (no second issue lookup). Used by
 * `GET /api/issues/$id/pending-approval`.
 */
export async function loadPendingApprovalRequestForRun(
  db: Db,
  activeRunId: string,
) {
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

  return request ?? null
}
