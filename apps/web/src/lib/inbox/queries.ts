import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const inboxKeys = {
  all: (wsId: string) => ['inbox', wsId] as const,
  list: (wsId: string) => [...inboxKeys.all(wsId), 'list'] as const,
}

// Pure thread helpers live in ./threads so server code can use them without
// the client API transport.
export {
  deduplicateInboxItems,
  groupInboxItems,
  type InboxThread,
} from './threads'

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
