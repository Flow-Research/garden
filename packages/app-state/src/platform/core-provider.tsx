import { useMemo, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { configureAuthStore, useAuthStore } from '../auth'
import { configureWorkspaceStore, useWorkspaceStore } from '../workspace'
import { createQueryClient } from '../query-client'
import type { CoreProviderProps } from './types'

let initialized = false

/**
 * Initializes app-state singletons and the API unauthorized boundary.
 *
 * Garden has no client token storage to clear on 401. The useful response to
 * an expired Better Auth session is to drop auth/workspace
 * state, clear React Query, and let the web shell navigate to login through the
 * provided logout callback. This keeps stale workspace shells from surviving an
 * expired cookie. Reference: Better Auth session cookies and local auth UX audit
 * from 2026-06-16.
 */
function initCore(
  api: CoreProviderProps['api'],
  configureApi: CoreProviderProps['configureApi'],
  apiBaseUrl: string,
  queryClient: ReturnType<typeof createQueryClient>,
  onLogout?: () => void,
) {
  if (initialized) return

  configureApi?.(apiBaseUrl, {
    onUnauthorized: () => {
      api.setWorkspaceHeader(null)
      useWorkspaceStore.getState().clearWorkspace()
      useAuthStore.setState({ user: null })
      queryClient.clear()
      onLogout?.()
    },
  })

  configureAuthStore({ api, onLogout })
  configureWorkspaceStore(api)

  initialized = true
}

export function CoreProvider({
  api,
  configureApi,
  children,
  apiBaseUrl = '',
  onLogout,
}: CoreProviderProps) {
  const [queryClient] = useState(createQueryClient)

  // Initialize module-owned stores on first render only. Dependencies are read-once:
  // apiBaseUrl and callbacks are set at app boot and never change at runtime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(
    () => initCore(api, configureApi, apiBaseUrl, queryClient, onLogout),
    [],
  )

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
