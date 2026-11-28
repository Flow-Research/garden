import { buildConnectorOAuthConfigs } from '@garden/connectors/oauth'

type ConnectorAuthEnvironment = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
}

/** Keeps provider registrations stable across the SDK callback-route change. */
export function connectorOAuthConfigs(
  env: ConnectorAuthEnvironment,
  baseURL: string,
) {
  return buildConnectorOAuthConfigs({
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET,
  }).map((config) => ({
    ...config,
    redirectURI: new URL(
      `/api/auth/oauth2/callback/${encodeURIComponent(config.providerId)}`,
      baseURL,
    ).href,
  }))
}

/** Maps only enabled, exact registered GET callbacks. The SDK verifies state. */
export function connectorCallbackRequest(
  request: Request,
  env: ConnectorAuthEnvironment,
) {
  if (request.method !== 'GET') return request
  const url = new URL(request.url)
  const provider = connectorOAuthConfigs(env, url.origin).find(
    (config) => url.href.split('?')[0] === config.redirectURI,
  )
  if (!provider) return request
  url.pathname = `/api/auth/callback/${encodeURIComponent(provider.providerId)}`
  return new Request(url, request)
}
