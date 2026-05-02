import type { ConnectorId } from '@garden/connectors/registry'
import type { RiskClass } from '@garden/connector-sdk'
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

export type ConnectionAction = 'disconnect' | 'resync'

export function listConnections(): Promise<ConnectionsSnapshot> {
  return getApiTransport().request('/api/connections')
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
