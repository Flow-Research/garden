import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { issueKeys } from './queries'
import { useLoadMoreDoneIssues } from './mutations'

const api = vi.hoisted(() => ({ listIssues: vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

describe('useLoadMoreDoneIssues', () => {
  it('reports a failed page instead of throwing', async () => {
    api.listIssues.mockRejectedValue(new Error('offline'))
    const queryClient = new QueryClient()
    queryClient.setQueryData(issueKeys.list('ws-1'), {
      issues: [],
      total: 5,
      doneTotal: 5,
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceIdProvider wsId="ws-1">{children}</WorkspaceIdProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useLoadMoreDoneIssues(), { wrapper })

    await act(() => result.current.loadMore())

    expect(result.current.failed).toBe(true)
    expect(result.current.isLoading).toBe(false)
  })
})
