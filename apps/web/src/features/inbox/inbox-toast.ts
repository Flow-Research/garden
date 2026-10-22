import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { InboxItem } from '@garden/core/types'
import { deduplicateInboxItems, inboxKeys } from '@/lib/inbox/queries'

export function selectInboxToastItems(
  seen: ReadonlySet<string>,
  items: InboxItem[],
): InboxItem[] {
  return items.filter(
    (item) =>
      !item.read &&
      !item.archived &&
      item.severity === 'action_required' &&
      !seen.has(item.id),
  )
}

const seenInboxToastIds = new Set<string>()
let inboxToastPrimed = false

export function subscribeInboxToasts(args: {
  queryClient: QueryClient
  workspaceId: string
  onOpen: () => void
}): () => void {
  const { queryClient, workspaceId, onOpen } = args
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] !== 'inbox') return
    const items = queryClient.getQueryData<InboxItem[]>(
      inboxKeys.list(workspaceId),
    )
    if (!items) return
    const unread = deduplicateInboxItems(items).filter((item) => !item.read)
    if (!inboxToastPrimed) {
      inboxToastPrimed = true
      for (const item of unread) seenInboxToastIds.add(item.id)
      return
    }
    const fresh = selectInboxToastItems(seenInboxToastIds, unread)
    for (const item of unread) seenInboxToastIds.add(item.id)
    for (const item of fresh) {
      toast(item.title, {
        id: item.id,
        description: item.body ?? undefined,
        action: { label: 'Open inbox', onClick: onOpen },
      })
    }
  })
}
