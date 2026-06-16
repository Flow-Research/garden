import { useRef } from 'react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { workspaceKeys } from '@/lib/workspace/queries'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getAuthBootstrap } from '@/lib/server/auth-bootstrap'

function scheduleClientStoreHydration(callback: () => void) {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback)
    return
  }
  void Promise.resolve().then(callback)
}

export const Route = createFileRoute('/_authenticated')({
  loader: async ({ location }) => {
    const bootstrap = await getAuthBootstrap()
    if (!bootstrap) {
      throw redirect({
        to: '/login',
        search: {
          redirect: sanitizeRedirectTarget(location.href, '/workspace'),
        },
      })
    }
    return bootstrap
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { preferredWorkspaceId, user, workspaces } = Route.useLoaderData()
  const qc = useQueryClient()
  const hydratedKey = useRef('')

  // Hydrate singleton stores after the render that consumes loader data.
  // Updating them during render trips React's setState-in-render guard because
  if (typeof window !== 'undefined') {
    const nextKey = `${user.id}:${preferredWorkspaceId ?? ''}:${workspaces.map((workspace) => `${workspace.id}:${workspace.updated_at}`).join(',')}`
    if (hydratedKey.current !== nextKey) {
      hydratedKey.current = nextKey
      scheduleClientStoreHydration(() => {
        qc.setQueryData(workspaceKeys.list(), workspaces)
        useAuthStore.setState({ user })
        const currentWorkspace = useWorkspaceStore.getState().workspace
        const shouldHydratePreferred =
          preferredWorkspaceId && currentWorkspace?.id !== preferredWorkspaceId

        if (!currentWorkspace || shouldHydratePreferred) {
          useWorkspaceStore
            .getState()
            .hydrateWorkspace(workspaces, preferredWorkspaceId)
        }
      })
    }
  }

  return <Outlet />
}
