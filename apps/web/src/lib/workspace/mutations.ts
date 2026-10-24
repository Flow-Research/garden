import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Result } from 'better-result'
import { toast } from 'sonner'
import type { Workspace } from '@garden/core/types'
import { api } from '@/lib/api'
import { workspaceKeys, workspaceListOptions } from './queries'
import { useWorkspaceStore } from '@garden/app-state/workspace'

export function useCreateWorkspace() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      api.createWorkspace(data),
    onSuccess: async (newWs) => {
      // Add to cache before switching so sidebar list is consistent on first render
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] = []) => [
        ...old,
        newWs,
      ])
      // Land on /home first — the old workspace's entity route would fire
      // detail queries with ids the new workspace doesn't own.
      void navigate({ to: '/home' })
      // The workspace exists even when switching to it fails; that failure
      // used to be dropped, leaving the user in the old workspace unawares.
      const switched = await Result.tryPromise(() =>
        useWorkspaceStore.getState().switchWorkspace(newWs),
      )
      if (Result.isError(switched)) {
        toast.error(
          `${newWs.name} was created, but switching to it failed. Open it from the workspace menu.`,
        )
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.list() })
    },
  })
}

/**
 * Reconciles the active workspace after the current user leaves one. Before this
 * helper, React Query could still contain the removed workspace and hydrate the
 * shell back into a dead organization. The function only runs for the active
 * workspace, forces a fresh list fetch with `staleTime: 0`, hydrates the next
 * available workspace locally, then asks Better Auth to persist that next active
 * organization in the background. This keeps the completed leave operation from
 * failing due to a follow-up switch failure while avoiding stale workspace UI.
 */
async function refreshWorkspaceAfterRemoval(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  const currentWsId = useWorkspaceStore.getState().workspace?.id
  if (currentWsId === workspaceId) {
    // staleTime: 0 forces a real network fetch — cache still has the removed workspace
    const wsList = await qc.fetchQuery({
      ...workspaceListOptions(),
      staleTime: 0,
    })
    const nextWorkspace = useWorkspaceStore.getState().hydrateWorkspace(wsList)
    if (nextWorkspace) {
      void Result.tryPromise(() =>
        useWorkspaceStore.getState().switchWorkspace(nextWorkspace),
      )
    }
  }
}

export function useLeaveWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { workspaceId: string }) => api.leaveWorkspace(args),
    onSuccess: async (_, { workspaceId }) => {
      await refreshWorkspaceAfterRemoval(qc, workspaceId)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.list() })
    },
  })
}
