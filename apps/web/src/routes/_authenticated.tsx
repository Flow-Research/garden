import { useMemo } from 'react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'
import { workspaceKeys } from '@/lib/workspace/queries'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getAuthBootstrap } from '@/lib/server/auth-bootstrap'

const PREFERRED_WORKSPACE_KEY = 'accelerate_workspace_id'

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

  // Hydrate auth + workspace state synchronously during render so children
  // render once with populated stores — no useEffect, no extra round-trip.
  // SSR pass skips the singleton mutation to avoid cross-request leaks; the
  // first client render re-hydrates before children read the store.
  useMemo(() => {
    if (typeof window === 'undefined') return
    useAuthStore.setState({ user })
    qc.setQueryData(workspaceKeys.list(), workspaces)
    if (!useWorkspaceStore.getState().workspace) {
      const preferred = window.localStorage.getItem(PREFERRED_WORKSPACE_KEY)
      useWorkspaceStore.getState().hydrateWorkspace(workspaces, preferred)
    }
  }, [user, workspaces, qc])

  return <Outlet />
}
