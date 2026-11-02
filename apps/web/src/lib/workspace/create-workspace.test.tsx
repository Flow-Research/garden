import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@garden/core/types'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useCreateWorkspace } from './mutations'

const api = vi.hoisted(() => ({ createWorkspace: vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

describe('useCreateWorkspace', () => {
  it('says so when the new workspace cannot be switched to', async () => {
    api.createWorkspace.mockResolvedValue({
      id: 'ws-2',
      name: 'Orchard',
    } as Workspace)
    useWorkspaceStore.setState({
      switchWorkspace: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    const error = vi.spyOn(toast, 'error')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useCreateWorkspace(), { wrapper })

    await act(() =>
      result.current.mutateAsync({ name: 'Orchard', slug: 'orchard' }),
    )

    expect(error).toHaveBeenCalledWith(
      'Orchard was created, but switching to it failed. Open it from the workspace menu.',
    )
  })
})
