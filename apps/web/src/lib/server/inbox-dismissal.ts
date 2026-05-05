import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { computeVisibleInboxItemKeys } from './inbox-compute'

type DismissArgs = {
  workspaceId: string
  userId: string
  itemKey: string
}

export async function dismissInboxItem(args: DismissArgs): Promise<void> {
  const db = getDb(appEnv)
  await db
    .insert(schema.inboxDismissal)
    .values({
      id: randomUUID(),
      workspaceId: args.workspaceId,
      userId: args.userId,
      itemKey: args.itemKey,
      dismissedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.inboxDismissal.workspaceId,
        schema.inboxDismissal.userId,
        schema.inboxDismissal.itemKey,
      ],
      set: { dismissedAt: new Date() },
    })
}

export async function dismissInboxItems(args: {
  workspaceId: string
  userId: string
  itemKeys: string[]
}): Promise<number> {
  if (args.itemKeys.length === 0) return 0
  const db = getDb(appEnv)
  const dismissedAt = new Date()
  const rows = args.itemKeys.map((itemKey) => ({
    id: randomUUID(),
    workspaceId: args.workspaceId,
    userId: args.userId,
    itemKey,
    dismissedAt,
  }))
  await db
    .insert(schema.inboxDismissal)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        schema.inboxDismissal.workspaceId,
        schema.inboxDismissal.userId,
        schema.inboxDismissal.itemKey,
      ],
      set: { dismissedAt },
    })
  return args.itemKeys.length
}

export async function dismissAllVisible(args: {
  workspaceId: string
  userId: string
  predicate?: (item: { read: boolean; issueStatus: string | null }) => boolean
}): Promise<number> {
  const keys = await computeVisibleInboxItemKeys({
    workspaceId: args.workspaceId,
    userId: args.userId,
    predicate: args.predicate,
  })
  return dismissInboxItems({
    workspaceId: args.workspaceId,
    userId: args.userId,
    itemKeys: keys,
  })
}

export async function deleteAllDismissals(args: {
  workspaceId: string
  userId: string
}): Promise<void> {
  const db = getDb(appEnv)
  await db
    .delete(schema.inboxDismissal)
    .where(
      and(
        eq(schema.inboxDismissal.workspaceId, args.workspaceId),
        eq(schema.inboxDismissal.userId, args.userId),
      ),
    )
}
