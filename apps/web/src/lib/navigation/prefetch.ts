import type { QueryClient } from '@tanstack/react-query'
import { isApiConfigured } from '@/lib/api'
import { useWorkspaceStore } from '@garden/app-state/workspace'

type PrefetchCandidate = {
  queryKey?: readonly unknown[]
  queryFn?: unknown
}

/**
 * Starts workspace-scoped queries when a surface is preloaded by intent.
 *
 * Route loaders run before the provider tree mounts during the first render,
 * so this exits until the browser API transport is ready. Later intent loads
 * warm React Query without blocking navigation; the destination component
 * keeps its existing loading or Suspense boundary. Reference: TanStack Router
 * data-loading guidance for external QueryClient caches.
 */
export function prefetchActiveWorkspace<TQuery extends PrefetchCandidate>(
  queryClient: QueryClient,
  options: (workspaceId: string) => ReadonlyArray<TQuery>,
) {
  if (typeof window === 'undefined' || !isApiConfigured()) return

  const workspaceId = useWorkspaceStore.getState().workspace?.id
  if (!workspaceId) return

  for (const query of options(workspaceId)) {
    // Intent prefetch is opportunistic. The destination query owns the error
    // state, so a failed hover request must not become an unhandled rejection.
    // TanStack's exact query-key generics are invariant here; route factories
    // provide the required key and function, so this cast only adapts their
    // typed options to the client method.
    void queryClient
      .prefetchQuery(
        query as unknown as Parameters<QueryClient['prefetchQuery']>[0],
      )
      .catch(() => undefined)
  }
}
