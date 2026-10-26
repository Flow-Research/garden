import type { ReactNode } from 'react'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Issue } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { issueDetailOptions, issueKeys } from './queries'
import { useDeleteIssue } from './mutations'

const api = vi.hoisted(() => ({
  deleteIssue: vi.fn(),
  getIssue: vi.fn(),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

const ISSUE = { id: 'issue-1', title: 'Fix login' } as Issue

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(issueKeys.detail('ws-1', 'issue-1'), ISSUE)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">{children}</WorkspaceIdProvider>
    </QueryClientProvider>
  )
  // The issue page stays mounted, observing the detail, while it deletes.
  const { result } = renderHook(
    () => ({
      detail: useQuery(issueDetailOptions('ws-1', 'issue-1')),
      remove: useDeleteIssue(),
    }),
    { wrapper },
  )
  return { result, queryClient }
}

describe('useDeleteIssue', () => {
  it('does not fetch the issue it is deleting', async () => {
    api.deleteIssue.mockResolvedValue(undefined)
    const { result } = setup()

    await act(() => result.current.remove.mutateAsync('issue-1'))

    expect(api.getIssue).not.toHaveBeenCalled()
    expect(result.current.detail.data).toEqual(ISSUE)
  })

  it('keeps the issue when deleting fails', async () => {
    api.deleteIssue.mockRejectedValue(new Error('offline'))
    const { result, queryClient } = setup()

    act(() => result.current.remove.mutate('issue-1'))
    await waitFor(() => expect(result.current.remove.isError).toBe(true))

    expect(api.getIssue).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryData(issueKeys.detail('ws-1', 'issue-1')),
    ).toEqual(ISSUE)
  })
})
