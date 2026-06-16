import { create } from 'zustand'
import type { Workspace } from '@garden/core/types'
import type { Api } from '../platform/app-api'
import { createLogger } from '@garden/observability/console'
import {
  setCurrentWorkspaceId,
  rehydrateAllWorkspaceStores,
} from '../platform/workspace-storage'

const logger = createLogger('workspace-store')

interface WorkspaceState {
  workspace: Workspace | null
}

interface WorkspaceActions {
  /**
   * Pick a workspace from a list and set it as current.
   * The list itself is NOT stored here — it lives in React Query.
   */
  hydrateWorkspace: (
    wsList: Workspace[],
    preferredWorkspaceId?: string | null,
  ) => Workspace | null
  /**
   * Switch to a workspace. Caller provides the full object from React Query.
   * Throws when the API cannot persist Better Auth's active organization.
   */
  switchWorkspace: (ws: Workspace) => Promise<void>
  /** Update current workspace data in place (e.g. after rename). */
  updateWorkspace: (ws: Workspace) => void
  clearWorkspace: () => void
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions

let workspaceApi: Pick<Api, 'setWorkspaceHeader' | 'setWorkspaceId'> | null =
  null

function getWorkspaceApi() {
  if (!workspaceApi) throw new Error('Workspace store not configured')
  return workspaceApi
}

export function configureWorkspaceStore(
  api: Pick<Api, 'setWorkspaceHeader' | 'setWorkspaceId'>,
) {
  workspaceApi = api
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  // Only the currently selected workspace (UI state).
  // The workspace list is server state and lives in React Query.
  workspace: null,

  hydrateWorkspace: (wsList, preferredWorkspaceId) => {
    const api = getWorkspaceApi()
    const nextWorkspace =
      (preferredWorkspaceId
        ? wsList.find((item) => item.id === preferredWorkspaceId)
        : null) ??
      wsList[0] ??
      null

    if (!nextWorkspace) {
      api.setWorkspaceHeader(null)
      setCurrentWorkspaceId(null)
      rehydrateAllWorkspaceStores()
      set({ workspace: null })
      return null
    }

    api.setWorkspaceHeader(nextWorkspace.id)
    setCurrentWorkspaceId(nextWorkspace.id)
    rehydrateAllWorkspaceStores()
    set({ workspace: nextWorkspace })
    logger.debug('hydrate workspace', nextWorkspace.name, nextWorkspace.id)

    return nextWorkspace
  },

  switchWorkspace: async (ws) => {
    const api = getWorkspaceApi()
    logger.info('switching to', ws.id)
    await api.setWorkspaceId(ws.id)
    setCurrentWorkspaceId(ws.id)
    rehydrateAllWorkspaceStores()
    set({ workspace: ws })
  },

  updateWorkspace: (ws) => {
    set((state) => ({
      workspace: state.workspace?.id === ws.id ? ws : state.workspace,
    }))
  },

  clearWorkspace: () => {
    const api = getWorkspaceApi()
    api.setWorkspaceHeader(null)
    setCurrentWorkspaceId(null)
    rehydrateAllWorkspaceStores()
    set({ workspace: null })
  },
}))
