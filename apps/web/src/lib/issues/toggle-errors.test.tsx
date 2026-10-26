import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToggleIssueReaction, useToggleIssueSubscriber } from './mutations'

const api = vi.hoisted(() => ({
  addIssueReaction: vi.fn(),
  subscribeToIssue: vi.fn(),
  unsubscribeFromIssue: vi.fn(),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    }
  >
    <WorkspaceIdProvider wsId="ws-1">{children}</WorkspaceIdProvider>
  </QueryClientProvider>
)

describe('toggle failures are reported', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issue reactions', async () => {
    api.addIssueReaction.mockRejectedValue(new Error('offline'))
    const error = vi.spyOn(toast, 'error')
    const { result } = renderHook(() => useToggleIssueReaction('issue-1'), {
      wrapper,
    })

    act(() => result.current.mutate({ emoji: '👍', existing: undefined }))

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Failed to update the reaction'),
    )
  })

  it('subscriptions', async () => {
    for (const fn of Object.values(api))
      fn.mockRejectedValue(new Error('offline'))
    const error = vi.spyOn(toast, 'error')
    const { result } = renderHook(() => useToggleIssueSubscriber('issue-1'), {
      wrapper,
    })

    act(() =>
      result.current.mutate({
        userId: 'user-1',
        userType: 'member',
        subscribed: false,
      }),
    )

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Failed to update the subscription'),
    )
  })
})
