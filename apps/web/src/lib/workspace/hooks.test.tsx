import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useActorName } from './hooks'
import { workspaceKeys } from './queries'

describe('useActorName', () => {
  it('names actors and keeps its functions stable between renders', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    })
    queryClient.setQueryData(workspaceKeys.members('ws-1'), [
      { user_id: 'u1', name: 'Ada Lovelace', avatar_url: 'ada.png' },
    ])
    queryClient.setQueryData(workspaceKeys.agents('ws-1'), [
      { id: 'a1', name: 'Garden', avatar_url: null },
    ])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceIdProvider wsId="ws-1">{children}</WorkspaceIdProvider>
      </QueryClientProvider>
    )
    const { result, rerender } = renderHook(() => useActorName(), { wrapper })

    expect(result.current.getActorName('member', 'u1')).toBe('Ada Lovelace')
    expect(result.current.getActorInitials('member', 'u1')).toBe('AL')
    expect(result.current.getActorAvatarUrl('member', 'u1')).toBe('ada.png')
    expect(result.current.getActorName('agent', 'a1')).toBe('Garden')
    expect(result.current.getActorName('agent', 'missing')).toBe(
      'Unknown Agent',
    )
    expect(result.current.getActorName('system', 'x')).toBe('System')

    const before = result.current.getActorName
    rerender()
    expect(result.current.getActorName).toBe(before)
  })
})
