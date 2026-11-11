import { eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Loads the workspace issue identifier prefix (`ISS` when unset).
 *
 * Shared by issue list/get mappers so routes and queries do not each
 * reimplement the organization lookup from `control-plane.ts`.
 */
export async function getWorkspaceIssuePrefix(
  db: Db,
  workspaceId: string,
): Promise<string> {
  const [row] = await db
    .select({ issuePrefix: schema.organization.issuePrefix })
    .from(schema.organization)
    .where(eq(schema.organization.id, workspaceId))
    .limit(1)
  return row && typeof row.issuePrefix === 'string' && row.issuePrefix
    ? row.issuePrefix
    : 'ISS'
}
