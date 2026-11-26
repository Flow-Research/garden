import { eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/** Loads the GitHub App installation row for a workspace, if any. */
export async function getGithubInstallationByWorkspace(
  db: Db,
  workspaceId: string,
) {
  const [installation] = await db
    .select()
    .from(schema.githubAppInstallation)
    .where(eq(schema.githubAppInstallation.workspaceId, workspaceId))
    .limit(1)
  return installation ?? null
}

export async function deleteGithubInstallationByWorkspace(
  db: Db,
  workspaceId: string,
) {
  await db
    .delete(schema.githubAppInstallation)
    .where(eq(schema.githubAppInstallation.workspaceId, workspaceId))
}

export async function updateGithubInstallationStatus(
  db: Db,
  input: { workspaceId: string; status: string },
) {
  await db
    .update(schema.githubAppInstallation)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(schema.githubAppInstallation.workspaceId, input.workspaceId))
}
