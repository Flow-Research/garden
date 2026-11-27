import { and, count, desc, eq, inArray, or } from 'drizzle-orm'
import { getDb, requireReturnedRow, schema } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'

/**
 * Postgres home for Files & Folders folder records (Penpot "Files & Folders
 * [DEV READY]"). Brain file items stay in Helix; these rows only own folder
 * metadata (name/privacy/creator) and folder↔file membership, joined to Helix
 * items by id at the API boundary.
 *
 * Privacy (product decision, 2026-09): 'private' = creator-only; 'shared' =
 * any workspace member. Enforced in these queries' WHERE clauses — a
 * non-creator gets null/false as if the folder did not exist (no 403 leak).
 */
export type BrainFolderRow = {
  id: string
  name: string
  privacy: 'private' | 'shared'
  fileCount: number
  createdByName: string
  createdByEmail: string
  createdAt: Date | null
}

type DbLike = Awaited<ReturnType<typeof getDb>>

const folderSelection = {
  id: schema.brainFolder.id,
  name: schema.brainFolder.name,
  privacy: schema.brainFolder.privacy,
  fileCount: count(schema.brainFolderFile.fileId),
  createdByName: schema.user.name,
  createdByEmail: schema.user.email,
  createdAt: schema.brainFolder.createdAt,
} as const

/** Folder cards show "Made by …"; profiles without a name fall back to email. */
export function brainFolderSummaryOf(row: BrainFolderRow) {
  return {
    id: row.id,
    name: row.name,
    privacy: row.privacy,
    fileCount: row.fileCount,
    createdByName: row.createdByName.trim() || row.createdByEmail,
    createdAt: (row.createdAt ?? new Date(0)).toISOString(),
  }
}

function folderListQuery(db: DbLike) {
  return db
    .select(folderSelection)
    .from(schema.brainFolder)
    .innerJoin(schema.user, eq(schema.brainFolder.createdBy, schema.user.id))
    .leftJoin(
      schema.brainFolderFile,
      eq(schema.brainFolderFile.folderId, schema.brainFolder.id),
    )
}

/** Visibility predicate: shared = workspace-open, private = creator-only. */
function visibleTo(userId: string) {
  return or(
    eq(schema.brainFolder.privacy, 'shared'),
    eq(schema.brainFolder.createdBy, userId),
  )
}

/** Lists the workspace folders visible to this member, newest first. */
export async function listBrainFolders(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  userId: string
}): Promise<BrainFolderRow[]> {
  const db = await getDb(args.env)
  const rows = await folderListQuery(db)
    .where(
      and(
        eq(schema.brainFolder.workspaceId, args.workspaceId),
        visibleTo(args.userId),
      ),
    )
    .groupBy(schema.brainFolder.id, schema.user.name, schema.user.email)
    .orderBy(desc(schema.brainFolder.createdAt))
  return rows
}

/** Reads one workspace folder visible to this member; null when missing, cross-workspace, or another's private folder. */
export async function getBrainFolder(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  userId: string
  folderId: string
}): Promise<BrainFolderRow | null> {
  const db = await getDb(args.env)
  const rows = await folderListQuery(db)
    .where(
      and(
        eq(schema.brainFolder.id, args.folderId),
        eq(schema.brainFolder.workspaceId, args.workspaceId),
        visibleTo(args.userId),
      ),
    )
    .groupBy(schema.brainFolder.id, schema.user.name, schema.user.email)
    .limit(1)
  return rows[0] ?? null
}

export async function createBrainFolder(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  userId: string
  name: string
  privacy: 'private' | 'shared'
}): Promise<{ id: string }> {
  const db = await getDb(args.env)
  const rows = await db
    .insert(schema.brainFolder)
    .values({
      workspaceId: args.workspaceId,
      name: args.name,
      privacy: args.privacy,
      createdBy: args.userId,
    })
    .returning({ id: schema.brainFolder.id })
  return requireReturnedRow(rows, 'brain folder')
}

/** Applies a rename/privacy change. The visibility predicate rides the WHERE clause, so non-creators of private folders get false → 404 without a pre-read. */
export async function updateBrainFolder(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  userId: string
  folderId: string
  name?: string
  privacy?: 'private' | 'shared'
}): Promise<boolean> {
  const db = await getDb(args.env)
  const updated = await db
    .update(schema.brainFolder)
    .set({
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.privacy !== undefined ? { privacy: args.privacy } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.brainFolder.id, args.folderId),
        eq(schema.brainFolder.workspaceId, args.workspaceId),
        visibleTo(args.userId),
      ),
    )
    .returning({ id: schema.brainFolder.id })
  return updated.length > 0
}

/** Deletes a folder; membership rows cascade. Files in Helix are untouched. */
export async function deleteBrainFolder(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  userId: string
  folderId: string
}): Promise<boolean> {
  const db = await getDb(args.env)
  const deleted = await db
    .delete(schema.brainFolder)
    .where(
      and(
        eq(schema.brainFolder.id, args.folderId),
        eq(schema.brainFolder.workspaceId, args.workspaceId),
        visibleTo(args.userId),
      ),
    )
    .returning({ id: schema.brainFolder.id })
  return deleted.length > 0
}

/** Lists member brain-file ids of one folder, oldest membership first. */
export async function listBrainFolderFileIds(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  folderId: string
}): Promise<string[]> {
  const db = await getDb(args.env)
  const rows = await db
    .select({ fileId: schema.brainFolderFile.fileId })
    .from(schema.brainFolderFile)
    .innerJoin(
      schema.brainFolder,
      and(
        eq(schema.brainFolder.id, schema.brainFolderFile.folderId),
        eq(schema.brainFolder.workspaceId, args.workspaceId),
      ),
    )
    .where(eq(schema.brainFolderFile.folderId, args.folderId))
    .orderBy(schema.brainFolderFile.createdAt)
  return rows.map((row) => row.fileId)
}

/** Adds a file to a folder. Returns false when already a member. */
export async function addBrainFolderFile(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  folderId: string
  fileId: string
  userId: string
}): Promise<boolean> {
  const db = await getDb(args.env)
  const inserted = await db
    .insert(schema.brainFolderFile)
    .values({
      folderId: args.folderId,
      fileId: args.fileId,
      addedBy: args.userId,
    })
    .onConflictDoNothing()
    .returning({ fileId: schema.brainFolderFile.fileId })
  return inserted.length > 0
}

/** Removes a file from a folder. Returns false when it was not a member. */
export async function removeBrainFolderFile(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  folderId: string
  fileId: string
}): Promise<boolean> {
  const db = await getDb(args.env)
  const deleted = await db
    .delete(schema.brainFolderFile)
    .where(
      and(
        eq(schema.brainFolderFile.folderId, args.folderId),
        eq(schema.brainFolderFile.fileId, args.fileId),
      ),
    )
    .returning({ fileId: schema.brainFolderFile.fileId })
  return deleted.length > 0
}

/** Drops every membership row for a deleted brain file — without it, folder cards' raw counts permanently disagree with the detail's live-filtered list. */
export async function deleteBrainFolderMembershipsByFileId(args: {
  env: Pick<AppEnv, 'HYPERDRIVE'>
  workspaceId: string
  fileId: string
}): Promise<void> {
  const db = await getDb(args.env)
  await db.delete(schema.brainFolderFile).where(
    and(
      eq(schema.brainFolderFile.fileId, args.fileId),
      // Scope via the parent folder row in case ids ever collide across tenants.
      inArray(
        schema.brainFolderFile.folderId,
        db
          .select({ id: schema.brainFolder.id })
          .from(schema.brainFolder)
          .where(eq(schema.brainFolder.workspaceId, args.workspaceId)),
      ),
    ),
  )
}
