import {
  archiveInboxItemsByKey,
  upsertIssueAssignmentInbox,
  upsertIssueMentionInbox,
} from '@garden/db/inbox'
import type { Db } from '@/lib/server/db'

/**
 * Archives inbox items by key. Wraps `@garden/db/inbox` so routes stay clear
 * of `@garden/db` imports.
 */
export async function archiveIssueInboxItemsByKey(
  db: Db,
  input: { workspaceId: string; itemKeys: string[] },
) {
  return await archiveInboxItemsByKey({
    db,
    workspaceId: input.workspaceId,
    itemKeys: input.itemKeys,
  })
}

/**
 * Upserts the assignment inbox item for an issue. Wraps `@garden/db/inbox`.
 */
export async function upsertIssueAssignmentInboxItem(
  db: Db,
  input: {
    workspaceId: string
    issueId: string
    actorType: 'member' | 'agent'
    actorId: string
  },
) {
  return await upsertIssueAssignmentInbox({
    db,
    workspaceId: input.workspaceId,
    issueId: input.issueId,
    actorType: input.actorType,
    actorId: input.actorId,
  })
}

/** Queues explicit member mentions through the shared inbox writer. */
export async function upsertIssueMentionInboxItem(
  db: Db,
  input: Omit<Parameters<typeof upsertIssueMentionInbox>[0], 'db'>,
) {
  return await upsertIssueMentionInbox({ db, ...input })
}
