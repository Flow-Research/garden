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
  upstream: ConnectorUpstream
  tools: Record<string, ConnectorToolClassification>
}

export type ConnectorSpec =
  | (ConnectorSpecBase & {
      oauth: ConnectorOAuth
      apiKey?: never
    })
  | (ConnectorSpecBase & {
      oauth?: never
      apiKey: ConnectorApiKey
    })
  | (ConnectorSpecBase & {
      oauth?: never
      apiKey?: never
    })

export function defineConnector(spec: ConnectorSpec): ConnectorSpec {
  return spec
}
