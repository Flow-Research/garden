import { createContext, useContext } from 'react'
import type { WorkspaceDockContextValue } from './types'

export const WorkspaceDockContext =
  createContext<WorkspaceDockContextValue | null>(null)

export function useWorkspaceDock() {
  return useContext(WorkspaceDockContext)
}

export function useRequiredWorkspaceDock() {
  const value = useWorkspaceDock()
  if (!value) {
    throw new Error(
      'useRequiredWorkspaceDock must be used inside WorkspaceDockProvider',
    )
  }
  return value
}
