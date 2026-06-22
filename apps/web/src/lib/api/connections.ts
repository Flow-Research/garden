import type { ConnectorId } from '@garden/connectors/registry'
import type { RiskClass } from '@garden/connectors/capabilities'
import { getApiTransport } from './state'

export type PermissionTrustLevel = 'auto' | 'allow' | 'ask'
export type ConnectorStatus =
  | 'available'
  | 'connected'
  | 'degraded'
  | 'disconnected'

export type ConnectionTool = {
  name: string
  description: string
  riskClass: RiskClass
  invocationCount: number
  grantsByAgent: Record<string, PermissionTrustLevel>
}

export type ConnectionItem = {
  id: ConnectorId
  label: string
  description: string
  status: ConnectorStatus
  authKind: 'oauth' | 'github_app' | 'discord_bot' | 'api_key' | 'none' | null
  accountLogin: string | null
  repositorySelection: string | null
  scopes: string[]
  connectedAt: string | null
  toolCount: number
  recentInvocations: number
  grants: { auto: number; allow: number; ask: number }
  tools: ConnectionTool[]
}

export type ConnectionsSnapshot = {
  summary: {
    connectorCount: number
    connectedCount: number
    toolCount: number
    recentInvocations: number
    agentCount: number
  }
  agents: Array<{ id: string; name: string; status: string }>
  connectors: ConnectionItem[]
}

export type ConnectionActivityItem = {
  id: string
  toolCallId: string
  toolName: string
  resultStatus: 'success' | 'error' | 'denied' | 'timeout'
  durationMs: number
  timestamp: string
  error: string | null
  agent: { id: string; name: string }
}

export type ConnectionActivityResponse = {
  connectorId: ConnectorId
  activity: ConnectionActivityItem[]
}

export type ConnectorCallbackEventItem = {
  id: string
  connectorId: ConnectorId
  connectorLabel: string
  providerId: string | null
  flowId: string | null
  source: 'oauth' | 'github_app' | 'discord_bot'
  status: 'success' | 'degraded' | 'error'
  stage: string
  message: string | null
  errorCode: string | null
  accountLogin: string | null
  createdAt: string
  completedAt: string | null
}

export type ConnectorCallbackEventResponse = {
  event: ConnectorCallbackEventItem
}

export type ConnectionAction = 'disconnect' | 'resync'

export function listConnections(options?: {
  summary?: boolean
  workspace_id?: string
}): Promise<ConnectionsSnapshot> {
  const search = new URLSearchParams()
  if (options?.summary) search.set('summary', '1')
  if (options?.workspace_id) search.set('workspace_id', options.workspace_id)
  const suffix = search.size ? `?${search}` : ''
  return getApiTransport().request(`/api/connections${suffix}`)
}

export function mutateConnection(
  connectorId: ConnectorId,
  action: ConnectionAction,
): Promise<unknown> {
  return getApiTransport().request(`/api/connections/${connectorId}`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

export function updateToolGrant(args: {
  connectorId: ConnectorId
  toolName: string
  agentId: string
  trustLevel: PermissionTrustLevel
}): Promise<unknown> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(args.connectorId)}/tools/${encodeURIComponent(args.toolName)}/grant`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        agentId: args.agentId,
        trustLevel: args.trustLevel,
      }),
    },
  )
}

export function getConnectorActivity(
  connectorId: ConnectorId,
): Promise<ConnectionActivityResponse> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(connectorId)}/activity`,
  )
}

export function getConnectorCallbackEvent(args: {
  flowId: string
  connectorId?: ConnectorId | null
}): Promise<ConnectorCallbackEventResponse> {
  const params = new URLSearchParams({ flow_id: args.flowId })
  if (args.connectorId) params.set('connector_id', args.connectorId)
  return getApiTransport().request(
    `/api/connections/callback-events?${params.toString()}`,
  )
}
