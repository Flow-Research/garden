import { connectorRegistry } from '@garden/connectors'
import type { ConnectorId } from '@garden/connectors/registry'
import {
  defaultTrustLevelForRisk,
  type PermissionTrustLevel,
  type RiskClass,
} from '@garden/connectors/capabilities'
import { desc } from 'drizzle-orm'
import { schema } from './db'

export type ConnectorStatus =
  | 'available'
  | 'connected'
  | 'degraded'
  | 'disconnected'

type ConnectionRow = typeof schema.account.$inferSelect
type GitHubInstallationRow = typeof schema.githubAppInstallation.$inferSelect
type CapabilityRow = typeof schema.capability.$inferSelect
type PermissionGrantRow = typeof schema.permissionGrant.$inferSelect
type ToolCallAuditRow = typeof schema.toolCallAudit.$inferSelect

export type ConnectionSurfaceTool = {
  name: string
  description: string
  riskClass: RiskClass
  invocationCount: number
  grantsByAgent: Record<string, PermissionTrustLevel>
}

export type ConnectionSurfaceItem = {
  id: ConnectorId
  label: string
  description: string
  status: ConnectorStatus
  scopes: string[]
  connectedAt: string | null
  toolCount: number
  recentInvocations: number
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
  githubInstallations: GitHubInstallationRow[]
  capabilities: CapabilityRow[]
  permissionGrants: PermissionGrantRow[]
  toolCallAudits: ToolCallAuditRow[]
}) {
  const {
    agentIds,
    connections,
    githubInstallations,
    capabilities,
    permissionGrants,
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

  const invocationCountByCapabilityId = new Map<string, number>()
  for (const audit of toolCallAudits) {
    const current = invocationCountByCapabilityId.get(audit.capabilityId) ?? 0
    invocationCountByCapabilityId.set(audit.capabilityId, current + 1)
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

  return connectorRegistry.map((connector) => {
    const connection = connections.find(
      (item) => item.connectorType === connector.id,
    )
    const githubInstallation =
      connector.id === 'github' ? githubInstallations[0] : null
    const dbTools = capabilitiesByConnector.get(connector.id) ?? []
    const tools = dbTools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      riskClass: (tool.riskClass as RiskClass | null) ?? 'read',
      invocationCount: invocationCountByCapabilityId.get(tool.id) ?? 0,
      grantsByAgent: Object.fromEntries(
        agentIds.map((agentId) => [
          agentId,
          trustByCapabilityIdAndAgentId.get(tool.id)?.get(agentId) ??
            defaultTrustLevelForRisk(
              (tool.riskClass as RiskClass | null) ?? 'read',
            ),
        ]),
      ) as Record<string, PermissionTrustLevel>,
    }))

    const recentInvocations = tools.reduce(
      (total, tool) => total + tool.invocationCount,
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
    const resolvedStatus: ConnectorStatus = githubInstallation
      ? ((githubInstallation.status as ConnectorStatus | undefined) ??
        'connected')
      : connection
        ? ((connection.status as ConnectorStatus | undefined) ?? 'connected')
        : connector.oauth
          ? 'available'
          : hasDiscoveredTools
            ? 'connected'
            : 'available'

    return {
      id: connector.id,
      label: connector.label,
      description: connector.description,
      status: resolvedStatus,
      scopes: githubInstallation
        ? ['github-app-installation']
        : (connection?.scopes ?? []),
      connectedAt: (githubInstallation?.createdAt ?? connection?.createdAt)
        ? new Date(
            githubInstallation?.createdAt ?? connection?.createdAt ?? new Date(),
          ).toISOString()
        : null,
      toolCount: tools.length,
      recentInvocations,
      grants,
      tools: tools
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          riskClass: tool.riskClass,
          invocationCount: tool.invocationCount,
          grantsByAgent: tool.grantsByAgent,
        })),
    }
  })
}

export const latestInvocationOrder = desc(schema.toolCallAudit.ts)
