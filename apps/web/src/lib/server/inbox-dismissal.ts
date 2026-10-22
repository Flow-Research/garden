import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { computeVisibleInboxItemKeys } from './inbox-compute'

type DismissArgs = {
  workspaceId: string
  userId: string
  itemKey: string
}

/**
 * Updates the issue thread that owns a selected inbox row.
 * The public Inbox contract exposes `item_key` as `InboxItem.id`; it does not
 * expose the database row UUID. The key resolves its issue, then the operation
 * updates every event in that thread. Standalone rows update by key only.
 */
async function updateInboxThread(
  args: DismissArgs & { archive: boolean },
): Promise<void> {
  const db = await getDb(appEnv)
  const [target] = await db
    .select({ issueId: schema.inboxItem.issueId })
    .from(schema.inboxItem)
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.recipientType, 'member'),
        eq(schema.inboxItem.recipientId, args.userId),
        eq(schema.inboxItem.itemKey, args.itemKey),
      ),
    )
  if (!target) return

  const threadFilter = target.issueId
    ? eq(schema.inboxItem.issueId, target.issueId)
    : eq(schema.inboxItem.itemKey, args.itemKey)
  await db
    .update(schema.inboxItem)
    .set({
      read: true,
      ...(args.archive ? { archived: true } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.recipientType, 'member'),
        eq(schema.inboxItem.recipientId, args.userId),
        threadFilter,
      ),
    )
}

export async function markInboxThreadRead(args: DismissArgs): Promise<void> {
  await updateInboxThread({ ...args, archive: false })
}

export async function archiveInboxThread(args: DismissArgs): Promise<void> {
  await updateInboxThread({ ...args, archive: true })
}

export async function markInboxItemsRead(args: {
  workspaceId: string
  userId: string
  itemKeys: string[]
}): Promise<number> {
  if (args.itemKeys.length === 0) return 0
  const db = await getDb(appEnv)
  const updatedAt = new Date()
  await db
    .update(schema.inboxItem)
    .set({ read: true, updatedAt })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.recipientType, 'member'),
        eq(schema.inboxItem.recipientId, args.userId),
        inArray(schema.inboxItem.itemKey, args.itemKeys),
      ),
    )
  return args.itemKeys.length
}

export async function archiveInboxItems(args: {
  workspaceId: string
  userId: string
  itemKeys: string[]
}): Promise<number> {
  if (args.itemKeys.length === 0) return 0
  const db = await getDb(appEnv)
  const updatedAt = new Date()
  await db
    .update(schema.inboxItem)
    .set({ read: true, archived: true, updatedAt })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.recipientType, 'member'),
        eq(schema.inboxItem.recipientId, args.userId),
        inArray(schema.inboxItem.itemKey, args.itemKeys),
      ),
    )
  return args.itemKeys.length
}

export async function markAllVisibleRead(args: {
  workspaceId: string
  userId: string
  predicate?: (item: { read: boolean; issueStatus: string | null }) => boolean
}): Promise<number> {
  const keys = await computeVisibleInboxItemKeys({
    workspaceId: args.workspaceId,
    userId: args.userId,
    predicate: args.predicate,
  })
  return markInboxItemsRead({
    workspaceId: args.workspaceId,
    userId: args.userId,
    itemKeys: keys,
  })
}

export async function archiveAllVisible(args: {
  workspaceId: string
  userId: string
  predicate?: (item: { read: boolean; issueStatus: string | null }) => boolean
}): Promise<number> {
  const keys = await computeVisibleInboxItemKeys({
    workspaceId: args.workspaceId,
    userId: args.userId,
    predicate: args.predicate,
  })
  return archiveInboxItems({
    workspaceId: args.workspaceId,
    userId: args.userId,
    itemKeys: keys,
  })
}

export async function deleteAllDismissals(args: {
  workspaceId: string
  userId: string
}): Promise<void> {
  const db = await getDb(appEnv)
  await db
    .update(schema.inboxItem)
    .set({ read: false, archived: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.recipientType, 'member'),
        eq(schema.inboxItem.recipientId, args.userId),
      ),
    )
}
