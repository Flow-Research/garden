import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@garden/core/types'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { isApiConfigured } from '@/lib/api'
import { prefetchActiveWorkspace } from './prefetch'

vi.mock('@/lib/api', () => ({
  isApiConfigured: vi.fn(),
}))

const apiConfigured = vi.mocked(isApiConfigured)

describe('prefetchActiveWorkspace', () => {
  afterEach(() => {
    apiConfigured.mockReset()
    useWorkspaceStore.setState({ workspace: null })
  })

  it('prefetches queries for the active workspace without blocking the loader', async () => {
    apiConfigured.mockReturnValue(true)
    useWorkspaceStore.setState({
      workspace: { id: 'workspace-1' } as Workspace,
    })
    const queryClient = new QueryClient()
    const queryFn = vi.fn().mockResolvedValue('warm')

    prefetchActiveWorkspace(queryClient, (workspaceId) => [
      { queryKey: ['surface', workspaceId], queryFn },
    ])

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(['surface', 'workspace-1'])).toBe('warm'),
    )
    queryClient.clear()
  })

  it('does nothing before the browser API transport is configured', () => {
    apiConfigured.mockReturnValue(false)
    useWorkspaceStore.setState({
      workspace: { id: 'workspace-1' } as Workspace,
    })
    const queryClient = new QueryClient()
    const queryFn = vi.fn().mockResolvedValue('warm')

    prefetchActiveWorkspace(queryClient, (workspaceId) => [
      { queryKey: ['surface', workspaceId], queryFn },
    ])

    expect(queryFn).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['surface', 'workspace-1'])).toBeUndefined()
    queryClient.clear()
  })
})
