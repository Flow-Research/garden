import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { GmailView } from '@/lib/api/gmail-contract'

export const gmailKeys = {
  all: (wsId: string) => ['gmail', wsId] as const,
  list: (wsId: string, view: GmailView) =>
    [...gmailKeys.all(wsId), 'list', view] as const,
}

export function gmailListOptions(wsId: string, view: GmailView | null) {
  return queryOptions({
    queryKey: gmailKeys.list(wsId, view ?? 'drafts'),
    queryFn: () => api.listGmail(view ?? 'drafts'),
    enabled: Boolean(wsId && view),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
}
