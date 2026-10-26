import {
  type FetchQueryOptions,
  QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  childIssuesOptions,
  issueRunEventsOptions,
  issueSubscribersOptions,
  issueTimelineOptions,
  issueUsageOptions,
} from './queries'

const api = vi.hoisted(() => ({
  getRunEvents: vi.fn(),
  listChildIssues: vi.fn(),
  listTimeline: vi.fn(),
  getIssue: vi.fn(),
  listIssueSubscribers: vi.fn(),
  getIssueUsage: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ api }))

describe('issue sub-resource queries', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) {
      fn.mockRejectedValue(new Error('offline'))
    }
  })

  // Each case fetches through the query client and returns the cache key.
  const cases: [string, (qc: QueryClient) => [Promise<unknown>, QueryKey]][] = [
    ['run events', (qc) => run(qc, issueRunEventsOptions('issue-1'))],
    ['children', (qc) => run(qc, childIssuesOptions('ws-1', 'issue-1'))],
    ['timeline', (qc) => run(qc, issueTimelineOptions('issue-1'))],
    ['subscribers', (qc) => run(qc, issueSubscribersOptions('issue-1'))],
    ['usage', (qc) => run(qc, issueUsageOptions('issue-1'))],
  ]

  it.each(cases)(
    '%s: a failed request is an error, not cached empty data',
    async (_, fetch) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const [request, queryKey] = fetch(queryClient)

      await expect(request).rejects.toThrow('offline')
      expect(queryClient.getQueryData(queryKey)).toBeUndefined()
    },
  )
})

function run<T, K extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>,
): [Promise<unknown>, QueryKey] {
  return [queryClient.fetchQuery(options), options.queryKey]
}
