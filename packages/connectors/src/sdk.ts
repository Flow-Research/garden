import type { NativeConnectorTool } from './effect/native.ts'

export type RiskClass = 'read' | 'write' | 'send_external' | 'destructive'

export type ConnectorToolClassification = {
  riskClass: RiskClass
  requiredScopes: string[]
  descriptionOverride?: string
}

export type ConnectorUpstream = {
  mcpServerUrl: string
  transport: 'streamable-http' | 'sse'
  headers?: Record<string, string>
}

export type ConnectorOAuth = {
  kind: 'oauth'
  providerId: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  apiHosts: string[]
}

export type ConnectorApiKey = {
  kind: 'api-key'
  envVar: string
  headerName: string
  apiHosts: string[]
}

type ConnectorSpecBase = {
  id: string
  label: string
  description: string
  icon?: string
  tools: Record<string, ConnectorToolClassification>
}

type ConnectorMcpSpecBase = ConnectorSpecBase & {
  kind?: 'mcp'
  upstream: ConnectorUpstream
  native?: never
}

export type ConnectorNativeSpec = ConnectorSpecBase & {
  kind: 'native'
  native: {
    /**
     * Installation-scoped native connectors are not auto-connected just because
     * the registry knows about them. They need provider install state before the
     * runtime can expose their tools to an agent.
     */
    availability: 'installation' | 'always'
    tools: readonly NativeConnectorTool[]
  }
  upstream?: never
  oauth?: never
  apiKey?: never
}

export type ConnectorMcpSpec =
  | (ConnectorMcpSpecBase & {
      oauth: ConnectorOAuth
      apiKey?: never
    })
  | (ConnectorMcpSpecBase & {
      oauth?: never
      apiKey: ConnectorApiKey
    })
  | (ConnectorMcpSpecBase & {
      oauth?: never
      apiKey?: never
    })

export type ConnectorSpec = ConnectorMcpSpec | ConnectorNativeSpec

export function defineConnector<TId extends string>(
  spec: ConnectorSpec & { readonly id: TId },
): ConnectorSpec & { readonly id: TId } {
  return spec
}

/** Narrows a registry entry to upstream-MCP connectors before proxy access. */
export function isMcpConnector(
  connector: ConnectorSpec,
): connector is ConnectorMcpSpec {
  return connector.kind !== 'native'
}

/** Narrows a registry entry to provider-native connectors. */
export function isNativeConnector(
  connector: ConnectorSpec,
): connector is ConnectorNativeSpec {
  return connector.kind === 'native'
}
