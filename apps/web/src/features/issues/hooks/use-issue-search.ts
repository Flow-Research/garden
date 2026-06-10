import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { SearchIssueResult } from '@garden/core/types'

type UseIssueSearchOptions = {
  debounceMs?: number
  excludeIds?: string[]
  includeClosed?: boolean
  limit?: number
}

export function useIssueSearch(options: UseIssueSearchOptions = {}) {
  const {
    debounceMs = 300,
    excludeIds = [],
    includeClosed = true,
    limit = 20,
  } = options

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchIssueResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  const runSearch = useCallback(
    (nextQuery: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()

      if (!nextQuery.trim()) {
        setResults([])
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      debounceRef.current = setTimeout(() => {
        const controller = new AbortController()
        abortRef.current = controller

        void api
          .searchIssues({
            q: nextQuery.trim(),
            limit,
            include_closed: includeClosed,
            signal: controller.signal,
          })
          .then((response) => {
            if (controller.signal.aborted) return
            setResults(
              response.issues.filter((issue) => !excludeIds.includes(issue.id)),
            )
            setIsLoading(false)
          })
          .catch(() => {
            if (controller.signal.aborted) return
            setIsLoading(false)
          })
      }, debounceMs)
    },
    [debounceMs, excludeIds, includeClosed, limit],
  )

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery)
      runSearch(nextQuery)
    },
    [runSearch],
  )

  const reset = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    setQuery('')
    setResults([])
    setIsLoading(false)
  }, [])

  return {
    query,
    results,
    isLoading,
    setQuery: updateQuery,
    reset,
  }
}
