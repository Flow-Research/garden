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
  it('still opens the new workspace locally when setActive fails', async () => {
    const created = {
      id: 'ws-2',
      name: 'Orchard',
    } as Workspace
    api.createWorkspace.mockResolvedValue(created)
    const hydrateWorkspace = vi.fn(() => created)
    useWorkspaceStore.setState({
      switchWorkspace: vi.fn(async () => {
        throw new Error('offline')
      }),
      hydrateWorkspace,
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

    expect(hydrateWorkspace).toHaveBeenCalledWith(
      expect.arrayContaining([created]),
      'ws-2',
    )
    expect(error).toHaveBeenCalledWith(
      'Orchard was created, but saving it as the active workspace failed. Reload if the wrong workspace appears.',
    )
  })
})
