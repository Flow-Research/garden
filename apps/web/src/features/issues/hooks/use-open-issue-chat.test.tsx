import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@garden/core/types'
import { useSurfaceTabsStore } from '@garden/app-state/surface-tabs'
import { useOpenIssueChat } from './use-open-issue-chat'

const nav = vi.hoisted(() => ({
  openChatSession: vi.fn(),
  openIssue: vi.fn(),
}))
vi.mock('@/features/navigation/use-surface-navigation', () => ({
  useSurfaceNavigation: () => nav,
}))
const api = vi.hoisted(() => ({ openChatForIssue: vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

const ISSUE = {
  id: 'issue-1',
  identifier: 'GAR-1',
  title: 'Fix login',
  status: 'todo',
  workspace_id: 'ws-1',
  assignee_type: 'agent',
  assignee_id: 'agent-1',
} as Issue

describe('useOpenIssueChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSurfaceTabsStore.setState({ bySurface: {} })
  })

  it('goes back to the issue and drops the chat tab when opening fails', async () => {
    api.openChatForIssue.mockRejectedValue(new Error('Agent unavailable'))
    nav.openChatSession.mockImplementation((session: { id: string }) =>
      useSurfaceTabsStore
        .getState()
        .upsertTab('chats', { id: session.id, title: 'Fix login' }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        {children}
      </QueryClientProvider>
    )
    const { result } = renderHook(
      () =>
        useOpenIssueChat({ issueId: 'issue-1', issue: ISSUE, userId: 'u1' }),
      { wrapper },
    )

    act(() => result.current.openChat())

    await waitFor(() =>
      expect(nav.openIssue).toHaveBeenCalledWith({
        id: 'issue-1',
        title: 'Fix login',
      }),
    )
    expect(useSurfaceTabsStore.getState().bySurface.chats ?? []).toEqual([])
  })
})
