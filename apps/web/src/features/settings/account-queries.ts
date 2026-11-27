import { queryOptions } from '@tanstack/react-query'
import { authClient } from '@/lib/auth/client'
import { authClientOperation } from '@/lib/auth/client-result'

/**
 * Active Better Auth sessions for the signed-in user. Shared by the Settings
 * modal and the routed Profile section so both read one cache entry.
 */
export function accountSessionsQueryOptions() {
  return queryOptions({
    queryKey: ['account', 'sessions'],
    queryFn: async () =>
      (
        await authClientOperation({
          fallbackMessage: 'Failed to load sessions',
          operation: 'list-sessions',
          request: () => authClient.listSessions(),
        })
      ).match({
        ok: (response) => Promise.resolve(response.data ?? []),
        // React Query reads a rejected query function as the error state.
        err: (error) => Promise.reject(error),
      }),
  })
}

/**
 * Sign-in accounts linked to the signed-in user, kept as a `Result` so callers
 * render load failures inline instead of through a query error state.
 */
export function linkedAccountsQueryOptions() {
  return queryOptions({
    queryKey: ['account', 'linked-accounts'],
    queryFn: () =>
      authClientOperation({
        fallbackMessage: 'Could not load linked accounts',
        operation: 'list-linked-accounts',
        request: () => authClient.listAccounts(),
      }),
  })
}
