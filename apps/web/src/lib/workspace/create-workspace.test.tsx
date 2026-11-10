import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@garden/core/types'
import {
  configureWorkspaceStore,
  useWorkspaceStore,
} from '@garden/app-state/workspace'
import { createQueryClient } from '@garden/app-state/platform/query-client'
import { useCreateWorkspace } from './mutations'
import { workspaceKeys } from './queries'

const mocks = vi.hoisted(() => ({
  api: { createWorkspace: vi.fn(), listWorkspaces: vi.fn() },
  navigate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))

const oldWorkspace: Workspace = {
  id: 'ws-1',
  name: 'Old workspace',
  slug: 'old',
  description: null,
  context: null,
  settings: {},
  issue_prefix: 'OLD',
  created_at: '',
  updated_at: '',
}
const created: Workspace = {
  ...oldWorkspace,
  id: 'ws-2',
  name: 'Orchard',
  slug: 'orchard',
}

/** Exercises the real store and permanent query cache used by the menu. */
function setup() {
  const queryClient = createQueryClient()
  queryClient.setQueryData(workspaceKeys.list(), [oldWorkspace])
  const setWorkspaceId = vi.fn().mockResolvedValue(undefined)
  configureWorkspaceStore({ setWorkspaceHeader: vi.fn(), setWorkspaceId })
  useWorkspaceStore.setState({ workspace: oldWorkspace })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useCreateWorkspace(), { wrapper })
  return { ...hook, queryClient, setWorkspaceId }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.api.createWorkspace.mockResolvedValue(created)
})

describe('useCreateWorkspace', () => {
  it('adds and selects a new workspace, then refreshes the destination bootstrap', async () => {
    const { result, queryClient, setWorkspaceId } = setup()
    await act(() =>
      result.current.mutateAsync({ name: 'Orchard', slug: 'orchard' }),
    )
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      created,
    ])
    expect(useWorkspaceStore.getState().workspace).toEqual(created)
    expect(setWorkspaceId).toHaveBeenCalledWith(created.id)
    expect(mocks.navigate.mock.calls).toEqual([
      [{ to: '/home', search: {} }],
      [{ to: '/home', search: { workspace_id: created.id } }],
    ])
    queryClient.clear()
  })

  it('cancels an older list request so its response cannot erase the created workspace', async () => {
    const { result, queryClient } = setup()
    let resolveOldList: (rows: Workspace[]) => void = () => {}
    const oldRequest = queryClient
      .fetchQuery({
        queryKey: workspaceKeys.list(),
        staleTime: 0,
        queryFn: () =>
          new Promise<Workspace[]>((resolve) => {
            resolveOldList = resolve
          }),
      })
      .catch(() => undefined)
    await act(() =>
      result.current.mutateAsync({ name: 'Orchard', slug: 'orchard' }),
    )
    resolveOldList([oldWorkspace])
    await oldRequest
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      created,
    ])
    expect(useWorkspaceStore.getState().workspace?.id).toBe(created.id)
    queryClient.clear()
  })

  it('upserts when the new workspace already arrived in a list response', async () => {
    const { result, queryClient } = setup()
    queryClient.setQueryData(workspaceKeys.list(), [oldWorkspace, created])
    await act(() =>
      result.current.mutateAsync({ name: 'Orchard', slug: 'orchard' }),
    )
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      created,
    ])
    queryClient.clear()
  })

  it('still opens the new workspace locally when setActive fails', async () => {
    const { result, queryClient, setWorkspaceId } = setup()
    setWorkspaceId.mockRejectedValue(new Error('offline'))
    const error = vi.spyOn(toast, 'error')
    await act(() =>
      result.current.mutateAsync({ name: 'Orchard', slug: 'orchard' }),
    )
    expect(useWorkspaceStore.getState().workspace).toEqual(created)
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
      created,
    ])
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(
      'Orchard was created, but saving it as the active workspace failed. Reload if the wrong workspace appears.',
    )
    queryClient.clear()
  })

  it('keeps the old workspace and list when creation fails', async () => {
    const { result, queryClient, setWorkspaceId } = setup()
    mocks.api.createWorkspace.mockRejectedValue(new Error('creation failed'))
    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'Orchard', slug: 'orchard' }),
      ).rejects.toThrow('creation failed')
    })
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([
      oldWorkspace,
    ])
    expect(useWorkspaceStore.getState().workspace).toEqual(oldWorkspace)
    expect(setWorkspaceId).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    queryClient.clear()
  })
})
