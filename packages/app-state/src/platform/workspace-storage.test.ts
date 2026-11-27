import { beforeEach, describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { StorageAdapter } from '@garden/core/types/storage'
import {
  createWorkspaceAwareStorage,
  setCurrentWorkspaceId,
  workspaceScopedMerge,
} from './workspace-storage'

/** Regression tests for the cross-workspace persist bleed — see workspaceScopedMerge. */

function makeAdapter() {
  const map = new Map<string, string>()
  const adapter: StorageAdapter = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
  return { adapter, map }
}

interface TabsState {
  tabs: string[]
  addTab: (id: string) => void
}

function makeTabsStore(adapter: StorageAdapter) {
  return create<TabsState>()(
    persist(
      (set) => ({
        tabs: [],
        addTab: (id) => set((s) => ({ tabs: [...s.tabs, id] })),
      }),
      {
        name: 'garden_test_tabs',
        storage: createJSONStorage(() => createWorkspaceAwareStorage(adapter)),
        partialize: (s) => ({ tabs: s.tabs }),
        merge: workspaceScopedMerge<TabsState>({ tabs: [] }),
      },
    ),
  )
}

/** Persist writes/rehydrates resolve through promise chains even with a sync adapter. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  setCurrentWorkspaceId(null)
})

describe('workspaceScopedMerge', () => {
  it('resets to initial state when the new workspace has no stored key', async () => {
    const { adapter, map } = makeAdapter()
    setCurrentWorkspaceId('ws-a')
    const store = makeTabsStore(adapter)
    await store.persist.rehydrate()

    store.getState().addTab('chat-1')
    await flush()
    expect(map.has('garden_test_tabs:ws-a')).toBe(true)

    // Switch to a workspace that never persisted: state must reset, not bleed.
    setCurrentWorkspaceId('ws-b')
    await store.persist.rehydrate()
    expect(store.getState().tabs).toEqual([])
  })

  it('does not write the previous workspace’s data into the new namespace', async () => {
    const { adapter, map } = makeAdapter()
    setCurrentWorkspaceId('ws-a')
    const store = makeTabsStore(adapter)
    await store.persist.rehydrate()
    store.getState().addTab('chat-1')
    await flush()

    setCurrentWorkspaceId('ws-b')
    await store.persist.rehydrate()
    store.getState().addTab('chat-2')
    await flush()

    const persistedB = JSON.parse(map.get('garden_test_tabs:ws-b') ?? '{}') as {
      state: { tabs: string[] }
    }
    expect(persistedB.state.tabs).toEqual(['chat-2'])
  })

  it('restores the original workspace’s state when switching back', async () => {
    const { adapter } = makeAdapter()
    setCurrentWorkspaceId('ws-a')
    const store = makeTabsStore(adapter)
    await store.persist.rehydrate()
    store.getState().addTab('chat-1')
    await flush()

    setCurrentWorkspaceId('ws-b')
    await store.persist.rehydrate()
    store.getState().addTab('chat-2')
    await flush()

    setCurrentWorkspaceId('ws-a')
    await store.persist.rehydrate()
    expect(store.getState().tabs).toEqual(['chat-1'])
  })
})
