import type { StateStorage } from 'zustand/middleware'
import type { StorageAdapter } from '@garden/core/types/storage'

let _currentWsId: string | null = null
const _rehydrateFns: Array<() => void> = []

export function setCurrentWorkspaceId(wsId: string | null) {
  _currentWsId = wsId
}

/** Register a persist store's rehydrate function to be called on workspace switch. */
export function registerForWorkspaceRehydration(fn: () => void) {
  _rehydrateFns.push(fn)
}

/** Rehydrate all registered workspace-scoped persist stores from the new namespace. */
export function rehydrateAllWorkspaceStores() {
  for (const fn of _rehydrateFns) {
    fn()
  }
}

export function getCurrentWorkspaceId(): string | null {
  return _currentWsId
}

/**
 * Storage that automatically namespaces keys with the current workspace ID.
 * Reads _currentWsId at call time, so it follows workspace switches dynamically.
 */
export function createWorkspaceAwareStorage(
  adapter: StorageAdapter,
): StateStorage {
  const resolve = (key: string) =>
    _currentWsId ? `${key}:${_currentWsId}` : key

  return {
    getItem: (key) => adapter.getItem(resolve(key)),
    setItem: (key, value) => adapter.setItem(resolve(key), value),
    removeItem: (key) => adapter.removeItem(resolve(key)),
  }
}

/**
 * Merge for workspace-scoped persist stores. Zustand's default merge
 * (`{...current, ...persisted}`) is a silent no-op when the new workspace has
 * no stored key, so the previous workspace's data survived rehydration and
 * bled into the new namespace on the next write (observed 2026-09; zustand
 * middleware.js hydrate). The initial data slice resets first, then any
 * persisted data overrides it; actions ride along via the current spread.
 */
export function workspaceScopedMerge<S extends object>(
  initialData: Partial<S>,
): (persistedState: unknown, currentState: S) => S {
  return (persistedState, currentState) => ({
    ...currentState,
    ...initialData,
    ...((persistedState ?? {}) as Partial<S>),
  })
}
