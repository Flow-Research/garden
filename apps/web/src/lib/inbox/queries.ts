import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { InboxItem } from '@garden/core/types'

export const inboxKeys = {
  all: (wsId: string) => ['inbox', wsId] as const,
  list: (wsId: string) => [...inboxKeys.all(wsId), 'list'] as const,
}

export type InboxThread = {
  id: string
  issueId: string | null
  items: InboxItem[]
  latest: InboxItem
  summary: InboxItem
  read: boolean
}

export function inboxListOptions(wsId: string) {
  return queryOptions({
    queryKey: inboxKeys.list(wsId),
    queryFn: () => api.listInbox({ workspace_id: wsId }),
    staleTime: 30_000,
    refetchInterval: 15_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * Groups active events into stable issue threads while retaining each event.
 * Before: the UI discarded every event except the newest one, so a review
 * report hid the agent comment posted seconds earlier. After: list consumers
 * still get one row per issue, while detail consumers can render the complete
 * event history. Items without an issue remain independent threads.
 */
export function groupInboxItems(items: InboxItem[]): InboxThread[] {
  const active = items.filter((i) => !i.archived)
  const groups = new Map<string, InboxItem[]>()
  for (const item of active) {
    const key = item.issue_id ? `issue:${item.issue_id}` : `item:${item.id}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }

  const threads: InboxThread[] = []
  for (const [id, group] of groups.entries()) {
    group.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    const latest = group[0]
    if (!latest) continue
    const read = group.every((item) => item.read)
    threads.push({
      id,
      issueId: latest.issue_id,
      items: group,
      latest,
      summary: latest.read === read ? latest : { ...latest, read },
      read,
    })
  }

  return threads.sort(
    (a, b) =>
      new Date(b.latest.created_at).getTime() -
      new Date(a.latest.created_at).getTime(),
  )
}

/** Returns one summary row per thread for shell-level unread indicators. */
export function deduplicateInboxItems(items: InboxItem[]): InboxItem[] {
  return groupInboxItems(items).map((thread) => thread.summary)
}
