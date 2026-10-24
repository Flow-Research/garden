import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Issue } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { teamKeys } from '@/features/teams/queries'
import { useUpdateIssue } from './mutations'

const api = vi.hoisted(() => ({ updateIssue: vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

const ISSUE = { id: 'issue-1', status: 'todo', team_id: 'team-1' } as Issue

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  const teamKey = teamKeys.issues('ws-1', 'team-1')
  queryClient.setQueryData(teamKey, [ISSUE])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">{children}</WorkspaceIdProvider>
    </QueryClientProvider>
  )
  const { result } = renderHook(() => useUpdateIssue(), { wrapper })
  const teamStatus = () =>
    queryClient.getQueryData<Issue[]>(teamKey)?.[0]?.status
  return { result, teamStatus }
}

describe('useUpdateIssue on Team boards', () => {
  it('moves the card on the Team board straight away', () => {
    api.updateIssue.mockReturnValue(new Promise(() => {}))
    const { result, teamStatus } = setup()

    act(() => result.current.mutate({ id: 'issue-1', status: 'in_progress' }))

    expect(teamStatus()).toBe('in_progress')
  })

  it('puts the card back when the move fails', async () => {
    api.updateIssue.mockRejectedValue(new Error('offline'))
    const { result, teamStatus } = setup()

    act(() => result.current.mutate({ id: 'issue-1', status: 'in_progress' }))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(teamStatus()).toBe('todo')
  })
})
