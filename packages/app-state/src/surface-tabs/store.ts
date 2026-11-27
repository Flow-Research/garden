import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
  workspaceScopedMerge,
} from '../platform/workspace-storage'
import { defaultStorage } from '../platform/storage'

/**
 * Per-surface tab state for the redesigned shell's tabbable surfaces
 * (Chats, Tasks). Replaces the retired global FlexLayout dock persistence:
 * each surface owns a small ordered list of open entity tabs, persisted per
 * workspace so a reload restores the strip. Surfaces subscribe with
 * `useSurfaceTabsStore((s) => s.bySurface[surface])` and navigate the router
 * on select/close — the store intentionally holds no routing logic.
 */
export interface SurfaceTabEntry {
  id: string
  title: string
}

/**
 * Shared empty list for selectors. zustand v5 requires getSnapshot results to
 * be reference-stable — a literal `?? []` inside a selector returns a new array
 * every call and loops React's "maximum update depth" guard (observed 2026-09
 * as a shell crash on any page render / dropdown open).
 */
export const EMPTY_SURFACE_TABS: SurfaceTabEntry[] = []

/**
 * Derived tab list that always contains the route-active entity: SSR
 * hard-loads skip the client-only loader bookkeeping, and insertion-ordered
 * MAX_TABS eviction can drop the active tab. Strips upgrade the placeholder
 * title live from query caches.
 */
export function withActiveTab(
  tabs: SurfaceTabEntry[],
  activeId: string | null,
): SurfaceTabEntry[] {
  if (activeId === null || tabs.some((tab) => tab.id === activeId)) {
    return tabs
  }
  return [...tabs, { id: activeId, title: activeId }]
}

interface SurfaceTabsState {
  bySurface: Record<string, SurfaceTabEntry[]>
  /** Adds the tab if absent, otherwise refreshes its title in place (insertion-ordered). */
  upsertTab: (surface: string, tab: SurfaceTabEntry) => void
  renameTab: (surface: string, id: string, title: string) => void
  closeTab: (surface: string, id: string) => void
  clearSurface: (surface: string) => void
}

const MAX_TABS_PER_SURFACE = 12

export const useSurfaceTabsStore = create<SurfaceTabsState>()(
  persist(
    (set) => ({
      bySurface: {},
      // Insertion-ordered, not MRU: re-activating a tab keeps its position so
      // the top-bar previous/next arrows can step a stable strip (MRU ordering
      // pinned the active tab to the end, leaving "next" permanently disabled
      // and "previous" alternating the last two — smoke-observed 2026-09).
      upsertTab: (surface, tab) =>
        set((state) => {
          const current = state.bySurface[surface] ?? []
          if (current.some((t) => t.id === tab.id)) {
            return {
              bySurface: {
                ...state.bySurface,
                [surface]: current.map((t) =>
                  t.id === tab.id ? { ...t, title: tab.title } : t,
                ),
              },
            }
          }
          return {
            bySurface: {
              ...state.bySurface,
              [surface]: [...current, tab].slice(-MAX_TABS_PER_SURFACE),
            },
          }
        }),
      renameTab: (surface, id, title) =>
        set((state) => {
          const current = state.bySurface[surface]
          if (!current) return state
          return {
            bySurface: {
              ...state.bySurface,
              [surface]: current.map((t) =>
                t.id === id ? { ...t, title } : t,
              ),
            },
          }
        }),
      closeTab: (surface, id) =>
        set((state) => {
          const current = state.bySurface[surface]
          if (!current) return state
          return {
            bySurface: {
              ...state.bySurface,
              [surface]: current.filter((t) => t.id !== id),
            },
          }
        }),
      clearSurface: (surface) =>
        set((state) => {
          if (!(surface in state.bySurface)) return state
          const next = { ...state.bySurface }
          delete next[surface]
          return { bySurface: next }
        }),
    }),
    {
      name: 'garden_surface_tabs',
      storage: createJSONStorage(() =>
        createWorkspaceAwareStorage(defaultStorage),
      ),
      partialize: (state) => ({ bySurface: state.bySurface }),
      merge: workspaceScopedMerge<SurfaceTabsState>({ bySurface: {} }),
    },
  ),
)

registerForWorkspaceRehydration(() => useSurfaceTabsStore.persist.rehydrate())
