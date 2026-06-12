import { Result } from 'better-result'
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
 * Updates both Garden's request header workspace and Better Auth's active
 * organization session. Before this, switching workspaces only changed the
 * in-memory `X-Workspace-ID` header, so reload fell back to the first listed
 * organization unless the URL carried `workspace_id`. Better Auth owns the
 * persisted workspace selection because a Garden workspace is an organization.
 * Reference: Better Auth organization `setActiveOrganization` endpoint.
 */
export function setWorkspaceId(id: string | null) {
  getApiTransport().setWorkspaceId(id)
  if (typeof window === 'undefined') return

  void Result.tryPromise({
    try: async () => {
      await fetch(`${getBaseUrl()}/api/auth/organization/set-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: id }),
      })
    },
    catch: (cause) => cause,
  })
}
