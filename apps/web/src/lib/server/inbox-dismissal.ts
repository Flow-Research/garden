import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { computeVisibleInboxItemKeys } from './inbox-compute'

type DismissArgs = {
  workspaceId: string
  userId: string
  itemKey: string
}

export async function markInboxItemRead(args: DismissArgs): Promise<void> {
  const db = await getDb(appEnv)
  await db
    .update(schema.inboxItem)
    .set({ read: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.recipientType, 'member'),
        eq(schema.inboxItem.recipientId, args.userId),
        eq(schema.inboxItem.itemKey, args.itemKey),
      ),
    )
}

export async function archiveInboxItem(args: DismissArgs): Promise<void> {
  const db = await getDb(appEnv)
  await db
    .update(schema.inboxItem)
    .set({ read: true, archived: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.recipientType, 'member'),
        eq(schema.inboxItem.recipientId, args.userId),
        eq(schema.inboxItem.itemKey, args.itemKey),
      ),
    )
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
