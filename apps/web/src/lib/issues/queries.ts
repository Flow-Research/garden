import { queryOptions } from '@tanstack/react-query'
import { Result } from 'better-result'
import type { Issue } from '@garden/core/types'
import { api } from '@/lib/api'

export const issueKeys = {
  all: (wsId: string) => ['issues', wsId] as const,
  list: (wsId: string) => [...issueKeys.all(wsId), 'list'] as const,
  search: (wsId: string, query: string) =>
    [...issueKeys.all(wsId), 'search', query] as const,
  allDone: (wsId: string) => [...issueKeys.all(wsId), 'all-done'] as const,
  detail: (wsId: string, id: string) =>
    [...issueKeys.all(wsId), 'detail', id] as const,
  children: (wsId: string, id: string) =>
    [...issueKeys.all(wsId), 'children', id] as const,
  childProgress: (wsId: string) =>
    [...issueKeys.all(wsId), 'child-progress'] as const,
  timeline: (issueId: string) => ['issues', 'timeline', issueId] as const,
  activeRun: (issueId: string) => ['issues', 'active-run', issueId] as const,
  workProducts: (issueId: string) =>
    ['issues', 'work-products', issueId] as const,
  runEvents: (issueId: string, runId?: string | null) =>
    ['issues', 'run-events', issueId, runId ?? 'active'] as const,
  reactions: (issueId: string) => ['issues', 'reactions', issueId] as const,
  subscribers: (issueId: string) => ['issues', 'subscribers', issueId] as const,
  usage: (issueId: string) => ['issues', 'usage', issueId] as const,
}

export function issueActiveRunOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.activeRun(issueId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.getActiveRun(issueId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      if (realCall.isOk()) return realCall.value
      throw realCall.error
    },
    refetchInterval: (query) => (query.state.data?.run ? 2000 : false),
    refetchOnWindowFocus: true,
  })
}

export function issueRunEventsOptions(issueId: string, runId?: string | null) {
  return queryOptions({
    queryKey: issueKeys.runEvents(issueId, runId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () =>
          api.getRunEvents(issueId, {
            ...(runId ? { run_id: runId } : {}),
            limit: 200,
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      return realCall.isOk() ? realCall.value : []
    },
    refetchInterval: runId ? 2000 : false,
    refetchOnWindowFocus: true,
  })
}

export function issueWorkProductsOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.workProducts(issueId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.listIssueWorkProducts(issueId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      if (realCall.isOk()) return realCall.value
      throw realCall.error
    },
    refetchOnWindowFocus: true,
  })
}

export const CLOSED_PAGE_SIZE = 50
const SEARCH_PAGE_SIZE = 100

/** Loads all done issues only while client-side filters need a complete set. */
export function allDoneIssuesOptions(wsId: string, enabled: boolean) {
  return queryOptions({
    queryKey: issueKeys.allDone(wsId),
    queryFn: async () => {
      const loadResult = await Result.tryPromise({
        try: async () => {
          const firstPage = await api.listIssues({
            workspace_id: wsId,
            status: 'done',
            limit: CLOSED_PAGE_SIZE,
            offset: 0,
          })
          const issues: Issue[] = [...firstPage.issues]
          while (issues.length < firstPage.total) {
            const page = await api.listIssues({
              workspace_id: wsId,
              status: 'done',
              limit: CLOSED_PAGE_SIZE,
              offset: issues.length,
            })
            if (page.issues.length === 0) break
            issues.push(...page.issues)
          }
          return issues
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      })
      if (loadResult.isOk()) return loadResult.value
      throw loadResult.error
    },
    enabled,
    staleTime: 30_000,
  })
}

/**
 * Fetches every server-matched issue page so search is authoritative across
 * closed-issue pagination. The prior local-only filter silently omitted done
 * issues beyond the warm first page and displayed misleading column counts.
 */
export function issueSearchOptions(wsId: string, query: string) {
  const normalizedQuery = query.trim()
  return queryOptions({
    queryKey: issueKeys.search(wsId, normalizedQuery),
    queryFn: async () => {
      const searchResult = await Result.tryPromise({
        try: async () => {
          const firstPage = await api.searchIssues({
            q: normalizedQuery,
            limit: SEARCH_PAGE_SIZE,
            offset: 0,
            include_closed: true,
            workspace_id: wsId,
          })
          const issues: Issue[] = [...firstPage.issues]
          while (issues.length < firstPage.total) {
            const page = await api.searchIssues({
              q: normalizedQuery,
              limit: SEARCH_PAGE_SIZE,
              offset: issues.length,
              include_closed: true,
              workspace_id: wsId,
            })
            if (page.issues.length === 0) break
            issues.push(...page.issues)
          }
          return issues
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      })
      if (searchResult.isOk()) return searchResult.value
      throw searchResult.error
    },
    enabled: normalizedQuery.length > 0,
    staleTime: 30_000,
  })
}

/**
 * CACHE SHAPE NOTE: The raw cache stores ListIssuesResponse ({ issues, total, doneTotal }),
 * but `select` transforms it to Issue[] for consumers. Mutations
 * must use setQueryData<ListIssuesResponse>(...) — NOT setQueryData<Issue[]>.
 *
 * Fetches all open issues + first page of done issues. Use useLoadMoreDoneIssues()
 * to paginate additional done items into the cache.
 *
 * Product feel: issue lists are user-generated but not tick-by-tick realtime.
 * Keeping them fresh briefly and retaining previous data avoids full-board
 * suspense/remount churn when users move between tabs or a mutation marks the
 * list stale after its optimistic cache write.
 */
export function issueListOptions(wsId: string) {
  return queryOptions({
    queryKey: issueKeys.list(wsId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => {
          const [openRes, closedRes] = await Promise.all([
            api.listIssues({ open_only: true, workspace_id: wsId }),
            api.listIssues({
              workspace_id: wsId,
              status: 'done',
              limit: CLOSED_PAGE_SIZE,
              offset: 0,
            }),
          ])
          return {
            issues: [...openRes.issues, ...closedRes.issues],
            total: openRes.total + closedRes.total,
            doneTotal: closedRes.total,
          }
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })

      if (realCall.isOk()) return realCall.value
      throw realCall.error
    },
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    select: (data) => data.issues,
  })
}

export function issueDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: issueKeys.detail(wsId, id),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.getIssue(id),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      if (realCall.isOk()) return realCall.value
      throw realCall.error
    },
  })
}

/**
 * Child progress changes only when child issue membership/status changes. Keep
 * previous progress visible during refresh so parent cards do not blink while
 * issue mutations settle.
 */
export function childIssueProgressOptions(wsId: string) {
  return queryOptions({
    queryKey: issueKeys.childProgress(wsId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.getChildIssueProgress({ workspace_id: wsId }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      if (realCall.isOk()) return realCall.value
      throw realCall.error
    },
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    select: (data) => {
      const map = new Map<string, { done: number; total: number }>()
      for (const entry of data.progress) {
        map.set(entry.parent_issue_id, { done: entry.done, total: entry.total })
      }
      return map
    },
  })
}

export function childIssuesOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: issueKeys.children(wsId, id),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => (await api.listChildIssues(id)).issues,
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      return realCall.isOk() ? realCall.value : []
    },
  })
}

export function issueTimelineOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.timeline(issueId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.listTimeline(issueId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      return realCall.isOk() ? realCall.value : []
    },
  })
}

export function issueReactionsOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.reactions(issueId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => {
          const issue = await api.getIssue(issueId)
          return issue.reactions ?? []
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      return realCall.isOk() ? realCall.value : []
    },
  })
}

export function issueSubscribersOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.subscribers(issueId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.listIssueSubscribers(issueId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      return realCall.isOk() ? realCall.value : []
    },
  })
}

export function issueUsageOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.usage(issueId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.getIssueUsage(issueId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      if (realCall.isOk()) return realCall.value
      return {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_read_tokens: 0,
        total_cache_write_tokens: 0,
        task_count: 0,
      }
    },
  })
}
