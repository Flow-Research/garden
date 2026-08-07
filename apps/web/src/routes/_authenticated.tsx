import { useRef, type ReactNode } from 'react'
import {
  Outlet,
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type { User } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { Button } from '@garden/ui/components/ui/button'
import { workspaceKeys } from '@/lib/workspace/queries'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getAuthBootstrap } from '@/lib/server/auth-bootstrap'
import { synchronizePostHogContext } from '@/lib/posthog-browser'

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
  errorComponent: AuthenticatedRouteError,
})

/**
 * Replaces authenticated route failures with a local recovery panel. The root
 * PostHog boundary is still useful for capture, but relying on it made route
 * render failures look like a full-app 500. Keeping the fallback at the auth
 * boundary preserves the document and leaves users a retry path. References:
 * TanStack Router `errorComponent` and the observed create-issue workspace
 * provider crash in PostHog issue 019ee9b6-0fed-78b1-8a51-b5c0e3f88a7c.
 */
function AuthenticatedRouteError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="grid h-svh place-items-center bg-background px-6 text-foreground">
      <section className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Workspace paused
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          This view hit a local error
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The app shell stayed alive. Retry the route, or refresh if the session
          changed underneath it.
        </p>
        {import.meta.env.DEV ? (
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
            {error.message}
          </p>
        ) : null}
        <Button type="button" className="mt-5" onClick={reset}>
          Retry
        </Button>
      </section>
    </main>
  )
}

/**
 * Owns the global authenticated workspace context. Garden previously mounted
 * `WorkspaceIdProvider` inside individual route shells, so shared workspace
 * actions could render outside the provider and crash when they called
 * workspace-scoped hooks. Keeping one boundary here makes workspace-scoped
 * UI available to every authenticated route while the singleton workspace
 * store remains the active-org bridge from Better Auth.
 */
function AuthenticatedWorkspaceContext({ children }: { children: ReactNode }) {
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.workspace?.id ?? null,
  )

  return activeWorkspaceId ? (
    <WorkspaceIdProvider wsId={activeWorkspaceId}>
      {children}
    </WorkspaceIdProvider>
  ) : (
    children
  )
}

function PostHogIdentitySync({ user }: { user: User }) {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const synchronizedKey = useRef('')

  if (typeof window !== 'undefined') {
    const nextKey = `${user.id}:${user.updated_at}:${workspace?.id ?? ''}:${workspace?.updated_at ?? ''}`
    if (synchronizedKey.current !== nextKey) {
      synchronizedKey.current = nextKey
      scheduleClientStoreHydration(() => {
        synchronizePostHogContext(user, workspace)
      })
    }
  }

  return null
}

function AuthenticatedLayout() {
  const { preferredWorkspaceId, user, workspaces } = Route.useLoaderData()
  const qc = useQueryClient()
  const hydratedKey = useRef('')

  // Hydrate singleton stores after the render that consumes loader data.
  // Updating them during render trips React's setState-in-render guard.
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

  return (
    <>
      <PostHogIdentitySync user={user} />
      <AuthenticatedWorkspaceContext>
        <Outlet />
      </AuthenticatedWorkspaceContext>
    </>
  )
}
