import { and, eq } from 'drizzle-orm'
import type { Issue } from '@garden/core/types/issue'
import { schema, type Db } from '@/lib/server/db'

/**
 * Partial issue update values for `PUT /api/issues/$id`. Kept free of route
 * HTTP types so the query module stays Drizzle-only.
 */
export type IssueRowUpdate = {
  title?: string
  description?: string | null
  status?: Issue['status']
  priority?: Issue['priority']
  position?: string
  dueDate?: Date | null
  assigneeId?: string | null
  assigneeType?: 'user' | 'agent' | null
  teamId?: string | null
  parentId?: string | null
  projectId?: string | null
  updatedAt: Date
}

/**
 * Updates one issue in a workspace and returns the row, or null when missing.
 */
export async function updateIssueRow(
  db: Db,
  input: {
    workspaceId: string
    issueId: string
    values: IssueRowUpdate
  },
) {
  const [issue] = await db
    .update(schema.issue)
    .set(input.values)
    .where(
      and(
        eq(schema.issue.id, input.issueId),
        eq(schema.issue.workspaceId, input.workspaceId),
      ),
    )
    .returning()
  return issue ?? null
}

/** Deletes one issue in a workspace. */
export async function deleteIssueRow(
  db: Db,
  input: { workspaceId: string; issueId: string },
) {
  await db
    .delete(schema.issue)
    .where(
      and(
        eq(schema.issue.id, input.issueId),
        eq(schema.issue.workspaceId, input.workspaceId),
      ),
    )
}

/** Loads a user email for assignment notification. */
export async function getUserEmail(db: Db, userId: string) {
  const [user] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
  return user?.email ?? null
}

/** Loads a workspace (organization) display name. */
export async function getOrganizationName(db: Db, workspaceId: string) {
  const [workspace] = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, workspaceId))
    .limit(1)
  return workspace?.name ?? null
}
