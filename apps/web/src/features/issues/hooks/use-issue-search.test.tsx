import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useIssueSearch } from './use-issue-search'

const api = vi.hoisted(() => ({ searchIssues: vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

const RESULTS = {
  issues: [
    { id: 'issue-1', title: 'Fix auth' },
    { id: 'issue-2', title: 'Auth docs' },
  ],
  total: 2,
}

function setup(excludeIds?: string[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceIdProvider wsId="ws-1">{children}</WorkspaceIdProvider>
    </QueryClientProvider>
  )
  return renderHook(() => useIssueSearch({ debounceMs: 10, excludeIds }), {
    wrapper,
  })
}

describe('useIssueSearch', () => {
  it('searches once the query settles and leaves out excluded issues', async () => {
    api.searchIssues.mockResolvedValue(RESULTS)
    const { result } = setup(['issue-2'])

    act(() => result.current.setQuery('a'))
    act(() => result.current.setQuery('auth'))
    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(api.searchIssues).toHaveBeenCalledTimes(1)
    expect(api.searchIssues.mock.calls[0]?.[0]).toMatchObject({ q: 'auth' })
    expect(result.current.results.map((issue) => issue.id)).toEqual(['issue-1'])
  })

  it('answers a repeated search from the cache', async () => {
    api.searchIssues.mockClear()
    api.searchIssues.mockResolvedValue(RESULTS)
    const { result } = setup()

    act(() => result.current.setQuery('auth'))
    await waitFor(() => expect(result.current.results).toHaveLength(2))
    act(() => result.current.reset())
    expect(result.current.results).toHaveLength(0)
    act(() => result.current.setQuery('auth'))
    await waitFor(() => expect(result.current.results).toHaveLength(2))

    expect(api.searchIssues).toHaveBeenCalledTimes(1)
  })
})
