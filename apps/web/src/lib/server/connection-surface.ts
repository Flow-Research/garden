import { connectorRegistry } from '@garden/connectors'
import type { ConnectorId } from '@garden/connectors/registry'
import {
  resolveEffectiveTrust,
  type PermissionTrustLevel,
  type RiskClass,
} from '@garden/connectors/capabilities'
import { desc } from 'drizzle-orm'
import type { AvailableConnectorBinding } from '@garden/server/connectors/availability'
import { schema } from './db'

export type ConnectorStatus =
  | 'available'
  | 'connected'
  | 'degraded'
  | 'disconnected'

type ConnectionRow = typeof schema.account.$inferSelect
type CapabilityRow = typeof schema.capability.$inferSelect
type PermissionGrantRow = typeof schema.permissionGrant.$inferSelect
type ConnectionGrantRow = typeof schema.connectionGrant.$inferSelect
type ToolCallAuditRow = typeof schema.toolCallAudit.$inferSelect

export type ConnectionSurfaceTool = {
  name: string
  description: string
  riskClass: RiskClass
  decisionCount: number
  grantsByAgent: Record<string, PermissionTrustLevel>
}

export type ConnectionSurfaceItem = {
  id: ConnectorId
  label: string
  description: string
  status: ConnectorStatus
  authKind: AvailableConnectorBinding['authKind'] | null
  accountLogin: string | null
  repositorySelection: string | null
  scopes: string[]
  connectedAt: string | null
  toolCount: number
  approvalDecisions: number
  grants: {
    auto: number
    allow: number
    ask: number
  }
  tools: ConnectionSurfaceTool[]
}

export function buildConnectionSurface(args: {
  agentIds: string[]
  connections: ConnectionRow[]
  availableConnectors: AvailableConnectorBinding[]
  capabilities: CapabilityRow[]
  permissionGrants: PermissionGrantRow[]
  connectionGrants: ConnectionGrantRow[]
  toolCallAudits: ToolCallAuditRow[]
}) {
  const {
    agentIds,
    connections,
    availableConnectors,
    capabilities,
    permissionGrants,
    connectionGrants,
    toolCallAudits,
  } = args

  const capabilitiesByConnector = new Map<
    string,
    Array<{
      id: string
      connectorType: string
      name: string
      description: string | null
      riskClass: string | null
    }>
  >()

  for (const capability of capabilities) {
    const group = capabilitiesByConnector.get(capability.connectorType) ?? []
    group.push({
      id: capability.id,
      connectorType: capability.connectorType,
      name: capability.name,
      description: capability.description,
      riskClass: capability.riskClass,
    })
    capabilitiesByConnector.set(capability.connectorType, group)
  }

  const decisionCountByCapabilityId = new Map<string, number>()
  for (const audit of toolCallAudits) {
    const current = decisionCountByCapabilityId.get(audit.capabilityId) ?? 0
    decisionCountByCapabilityId.set(audit.capabilityId, current + 1)
  }

  const trustByCapabilityIdAndAgentId = new Map<
    string,
    Map<string, PermissionTrustLevel>
  >()
  for (const grant of permissionGrants) {
    const trustByAgent =
      trustByCapabilityIdAndAgentId.get(grant.capabilityId) ?? new Map()
    trustByAgent.set(grant.agentId, grant.trustLevel as PermissionTrustLevel)
    trustByCapabilityIdAndAgentId.set(grant.capabilityId, trustByAgent)
  }

  const connectionTrustByConnectorAndAgentId = new Map<
    string,
    Map<string, PermissionTrustLevel>
  >()
  for (const grant of connectionGrants) {
    const trustByAgent =
      connectionTrustByConnectorAndAgentId.get(grant.connectorId) ?? new Map()
    trustByAgent.set(grant.agentId, grant.trustLevel as PermissionTrustLevel)
    connectionTrustByConnectorAndAgentId.set(grant.connectorId, trustByAgent)
  }

  return connectorRegistry.map((connector) => {
    const connection = connections.find(
      (item) => item.connectorType === connector.id,
    )
    const availableConnector = availableConnectors.find(
      (item) => item.connectorId === connector.id,
    )
    const dbTools = capabilitiesByConnector.get(connector.id) ?? []
    const tools = dbTools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      riskClass: (tool.riskClass as RiskClass | null) ?? 'read',
      decisionCount: decisionCountByCapabilityId.get(tool.id) ?? 0,
      grantsByAgent: Object.fromEntries(
        agentIds.map((agentId) => [
          agentId,
          resolveEffectiveTrust({
            toolTrust: trustByCapabilityIdAndAgentId.get(tool.id)?.get(agentId),
            connectionTrust: connectionTrustByConnectorAndAgentId
              .get(tool.connectorType)
              ?.get(agentId),
            riskClass: (tool.riskClass as RiskClass | null) ?? 'read',
          }).trust,
        ]),
      ) as Record<string, PermissionTrustLevel>,
    }))

    const approvalDecisions = tools.reduce(
      (total, tool) => total + tool.decisionCount,
      0,
    )

    const grants = tools.reduce(
      (totals, tool) => {
        for (const trustLevel of Object.values(tool.grantsByAgent)) {
          totals[trustLevel] += 1
        }

        return totals
      },
      { auto: 0, allow: 0, ask: 0 },
    )

    const hasDiscoveredTools = dbTools.length > 0
    const resolvedStatus: ConnectorStatus = availableConnector
      ? availableConnector.status
      : connection
        ? ((connection.status as ConnectorStatus | undefined) ?? 'connected')
        : connector.oauth || connector.apiKey
          ? 'available'
          : hasDiscoveredTools
            ? 'connected'
            : 'available'

    return {
      id: connector.id,
      label: connector.label,
      description: connector.description,
      status: resolvedStatus,
      authKind: availableConnector?.authKind ?? null,
      accountLogin: availableConnector?.accountLogin ?? null,
      repositorySelection: availableConnector?.repositorySelection ?? null,
      scopes: availableConnector
        ? [
            availableConnector.authKind,
            ...(availableConnector.accountLogin
              ? [`account:${availableConnector.accountLogin}`]
              : []),
            ...(availableConnector.repositorySelection
              ? [
                  `repository_selection:${availableConnector.repositorySelection}`,
                ]
              : []),
          ]
        : (connection?.scopes ?? []),
      connectedAt: connection?.createdAt
        ? new Date(connection.createdAt).toISOString()
        : null,
      toolCount: tools.length,
      approvalDecisions,
      grants,
      tools: tools
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          riskClass: tool.riskClass,
          decisionCount: tool.decisionCount,
          grantsByAgent: tool.grantsByAgent,
        })),
    }
  })
}

export const latestInvocationOrder = desc(schema.toolCallAudit.ts)
