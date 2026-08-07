import {
  connectorRegistry,
  type ConnectorId,
  type RegisteredConnector,
} from './registry'
import { isMcpConnector } from './sdk.ts'

export type ConnectorOAuthProviderConfig = {
  providerId: string
  clientId: string
  clientSecret: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  accessType?: string
  prompt?:
    | 'none'
    | 'login'
    | 'create'
    | 'consent'
    | 'select_account'
    | 'select_account consent'
    | 'login consent'
}

export type ConnectorOAuthEnvVarNames = {
  clientId: string
  clientSecret: string
}

export type ConnectorOAuthEnv = Record<string, string | undefined>

const connectorOAuthEnvVarNames = {
  github: {
    clientId: 'GITHUB_CLIENT_ID',
    clientSecret: 'GITHUB_CLIENT_SECRET',
  },
  slack: {
    clientId: 'SLACK_CLIENT_ID',
    clientSecret: 'SLACK_CLIENT_SECRET',
  },
  gmail: {
    clientId: 'GOOGLE_CLIENT_ID',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
  },
  'google-drive': {
    clientId: 'GOOGLE_CLIENT_ID',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
  },
} as const satisfies Partial<Record<ConnectorId, ConnectorOAuthEnvVarNames>>

function isGoogleConnector(connector: RegisteredConnector) {
  return connector.id === 'gmail' || connector.id === 'google-drive'
}

function resolveConnector(connector: RegisteredConnector | ConnectorId) {
  return typeof connector === 'string'
    ? connectorRegistry.find((entry) => entry.id === connector)
    : connector
}

export function getConnectorOAuthEnvVarNames(
  connector: RegisteredConnector | ConnectorId,
) {
  const resolvedConnector = resolveConnector(connector)
  if (
    !resolvedConnector ||
    !isMcpConnector(resolvedConnector) ||
    !resolvedConnector.oauth
  ) {
    return undefined
  }
  return connectorOAuthEnvVarNames[
    resolvedConnector.id as keyof typeof connectorOAuthEnvVarNames
  ]
}

export function getConnectorOAuthCredentials(
  env: ConnectorOAuthEnv,
  connector: RegisteredConnector | ConnectorId,
) {
  const envVarNames = getConnectorOAuthEnvVarNames(connector)
  if (!envVarNames) return undefined

  const clientId = env[envVarNames.clientId]?.trim()
  const clientSecret = env[envVarNames.clientSecret]?.trim()

  if (!clientId || !clientSecret) return undefined

  return {
    clientId,
    clientSecret,
  }
}

export function buildConnectorOAuthConfig(
  env: ConnectorOAuthEnv,
  connector: RegisteredConnector,
): ConnectorOAuthProviderConfig | undefined {
  if (!isMcpConnector(connector) || !connector.oauth) return undefined

  const credentials = getConnectorOAuthCredentials(env, connector)
  if (!credentials) return undefined

  return {
    providerId: connector.oauth.providerId,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    authorizationUrl: connector.oauth.authUrl,
    tokenUrl: connector.oauth.tokenUrl,
    scopes: connector.oauth.scopes,
    ...(isGoogleConnector(connector)
      ? {
          accessType: 'offline',
          prompt: 'select_account consent' as const,
        }
      : {}),
  }
}

export function buildConnectorOAuthConfigs(env: ConnectorOAuthEnv) {
  return connectorRegistry.flatMap((connector) => {
    const config = buildConnectorOAuthConfig(env, connector)
    return config ? [config] : []
  })
}
