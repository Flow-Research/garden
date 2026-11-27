import {
  addIssueSubscribers,
  assigneeToSubscriberType,
  listIssueSubscribers,
  type SubscriberEntry,
} from '@garden/db/subscribers'
import type { Db } from '@/lib/server/db'

export { assigneeToSubscriberType }
export type { SubscriberEntry }

/**
 * Lists persisted issue subscribers. Wraps `@garden/db/subscribers` so API
 * routes never import `@garden/db` directly.
 */
export async function listIssueSubscriberRows(db: Db, issueId: string) {
  return await listIssueSubscribers(db, { issueId })
}

/**
 * Adds issue subscribers. Wraps `@garden/db/subscribers` for route layering.
 */
export async function addIssueSubscriberRows(
  db: Db,
  input: {
    workspaceId: string
    issueId: string
    entries: SubscriberEntry[]
  },
) {
  return await addIssueSubscribers(db, input)
}
