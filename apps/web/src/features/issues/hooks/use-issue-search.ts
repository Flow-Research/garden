import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { api } from '@/lib/api'
import { issueKeys } from '@/lib/issues/queries'
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value'
import type { SearchIssueResult } from '@garden/core/types'

type UseIssueSearchOptions = {
  debounceMs?: number
  excludeIds?: string[]
  includeClosed?: boolean
  limit?: number
}

const NO_RESULTS: SearchIssueResult[] = []

/**
 * Quick issue search for pickers and the command palette, through TanStack
 * Query on a debounced query. It used to fetch by hand with its own timers
 * and abort controllers and no cache, so repeating a search refetched it,
 * and a default `excludeIds = []` made its callback new on every render.
 */
export function useIssueSearch(options: UseIssueSearchOptions = {}) {
  const {
    debounceMs = 300,
    excludeIds,
    includeClosed = true,
    limit = 20,
  } = options
  const wsId = useWorkspaceId()
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, debounceMs)

  const searchQuery = useQuery({
    queryKey: [
      ...issueKeys.searches(wsId),
      'quick',
      { q: debounced, limit, includeClosed },
    ],
    queryFn: ({ signal }) =>
      api.searchIssues({
        q: debounced,
        limit,
        include_closed: includeClosed,
        signal,
      }),
    enabled: debounced.length > 0,
    staleTime: 30_000,
    // Keep the last results on screen while the next query loads.
    placeholderData: keepPreviousData,
  })

  const excludeKey = excludeIds?.join('\n') ?? ''
  const results = useMemo(() => {
    if (!trimmed || !searchQuery.data) return NO_RESULTS
    const excluded = new Set(excludeKey ? excludeKey.split('\n') : [])
    return searchQuery.data.issues.filter((issue) => !excluded.has(issue.id))
  }, [trimmed, searchQuery.data, excludeKey])

  const isLoading =
    trimmed.length > 0 && (trimmed !== debounced || searchQuery.isFetching)

  const reset = useCallback(() => setQuery(''), [])

  return {
    query,
    results,
    isLoading,
    setQuery,
    reset,
  }
}
