import { Result } from 'better-result'
import { authClient } from '@/lib/auth/client'
import { ApiError } from './errors'
import { ApiTransport, type ApiTransportOptions } from './transport'

let transport: ApiTransport | null = null

export function configureApi(baseUrl: string, options?: ApiTransportOptions) {
  transport = new ApiTransport(baseUrl, options)
  return transport
}

export function getApiTransport() {
  if (!transport) {
    throw new Error('API transport not initialised - call configureApi() first')
  }
  return transport
}

export function getBaseUrl() {
  return getApiTransport().getBaseUrl()
}

/**
 * Updates only Garden's in-memory workspace request header.
 *
 * Loader bootstrap and Better Auth organization actions already know the active
 * organization on the server. They need the client transport to follow that
 * server truth without writing the session again. User-initiated switches use
 * `setWorkspaceId`, which persists through Better Auth before mutating local
 * workspace UI state. Reference: Better Auth organization `set-active` route.
 */
export function setWorkspaceHeader(id: string | null) {
  getApiTransport().setWorkspaceId(id)
}

/**
 * Persists Garden's selected workspace through Better Auth's organization
 * client, then updates the request header used by Garden API calls.
 *
 * Before this change workspace switches fired `/organization/set-active` through
 * raw `fetch` in the background and swallowed failures. Garden already installs
 * `organizationClient()`, so the client method is the correct source of truth
 * for active-organization cache invalidation and session updates. Reference:
 * Better Auth organization `authClient.organization.setActive`.
 */
export async function setWorkspaceId(id: string | null): Promise<void> {
  if (typeof window === 'undefined') {
    setWorkspaceHeader(id)
    return
  }

  const result = (
    await Result.tryPromise({
      try: async () =>
        await authClient.organization.setActive({ organizationId: id }),
      catch: (cause) =>
        new ApiError({
          message:
            cause instanceof Error ? cause.message : 'Workspace switch failed',
          status: 0,
          statusText: 'Network Error',
        }),
    })
  ).andThen((response) =>
    response.error
      ? Result.err(
          new ApiError({
            message: response.error.message || 'Workspace switch failed',
            status: response.error.status ?? 400,
            statusText: response.error.statusText ?? 'Bad Request',
          }),
        )
      : Result.ok(id),
  )

  return result.match({
    ok: (workspaceId) => setWorkspaceHeader(workspaceId),
    err: (error) => {
      throw error
    },
  })
}
