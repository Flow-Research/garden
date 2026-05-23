import { useRef } from 'react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'
import { workspaceKeys } from '@/lib/workspace/queries'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getAuthBootstrap } from '@/lib/server/auth-bootstrap'

const PREFERRED_WORKSPACE_KEY = 'garden_workspace_id'

function scheduleClientStoreHydration(callback: () => void) {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback)
    return
  }
  void Promise.resolve().then(callback)
}

export const Route = createFileRoute('/_authenticated')({
  staleTime: Number.POSITIVE_INFINITY,
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
  const { user, workspaces } = Route.useLoaderData()
  const qc = useQueryClient()
  const hydratedKey = useRef('')

  // Hydrate singleton stores after the render that consumes loader data.
  // Updating them during render trips React's setState-in-render guard because
  // WSProvider subscribes above this route.
  if (typeof window !== 'undefined') {
    const nextKey = `${user.id}:${workspaces.map((workspace) => workspace.id).join(',')}`
    if (hydratedKey.current !== nextKey) {
      hydratedKey.current = nextKey
      scheduleClientStoreHydration(() => {
        qc.setQueryData(workspaceKeys.list(), workspaces)
        useAuthStore.setState({ user })
        if (!useWorkspaceStore.getState().workspace) {
          const preferred = window.localStorage.getItem(PREFERRED_WORKSPACE_KEY)
          useWorkspaceStore.getState().hydrateWorkspace(workspaces, preferred)
        }
      })
    }
  }

  return <Outlet />
}
