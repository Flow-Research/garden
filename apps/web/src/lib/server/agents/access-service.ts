import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import {
  resolveEffectiveTrust,
  type PermissionTrustLevel,
} from '@garden/connectors/capabilities'
import type { Db } from '@/lib/server/db'
import {
  listAllCapabilities,
  listAgentConnectionGrants,
  listAgentPermissionGrants,
} from '@/lib/server/queries/agents'
import { agentExistsInWorkspace } from '@/lib/server/queries/issues/agents'

export class AgentAccessError extends TaggedError('AgentAccessError')<{
  message: string
  status: number
}>() {}

/**
 * Assembles the agent access review payload: connections and tools with
 * effective trust. The route owns session and workspace checks.
 */
export async function getAgentAccessState(input: {
  db: Db
  workspaceId: string
  agentId: string
}): Promise<
  ResultValue<
    {
      connections: Array<{
        connector_id: string
        trust: string
        granted: boolean
        visible: boolean
      }>
      tools: Array<{
        connector_id: string
        tool_name: string
        risk_class: string
        trust: PermissionTrustLevel
        granted: boolean
        visible: boolean
      }>
    },
    AgentAccessError
  >
> {
  const existsResult = await Result.tryPromise({
    try: async () =>
      await agentExistsInWorkspace(input.db, {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      }),
    catch: () =>
      new AgentAccessError({
        status: 500,
        message: 'Failed to load agent for access review',
      }),
  })
  if (existsResult.isErr()) return Result.err(existsResult.error)
  if (!existsResult.value) {
    return Result.err(
      new AgentAccessError({
        status: 404,
        message: 'Agent not found',
      }),
    )
  }

  const accessResult = await Result.tryPromise({
    try: async () => {
      const [capabilities, toolGrants, connectionGrants] = await Promise.all([
        listAllCapabilities(input.db),
        listAgentPermissionGrants(input.db, input.agentId),
        listAgentConnectionGrants(input.db, input.agentId),
      ])
      return { capabilities, toolGrants, connectionGrants }
    },
    catch: () =>
      new AgentAccessError({
        status: 500,
        message: 'Failed to load agent access state',
      }),
  })
  if (accessResult.isErr()) return Result.err(accessResult.error)

  const { capabilities, toolGrants, connectionGrants } = accessResult.value
  const toolGrantByCapability = new Map(
    toolGrants.map((grant) => [grant.capabilityId, grant.trustLevel]),
  )
  const connectionGrantByConnector = new Map(
    connectionGrants.map((grant) => [grant.connectorId, grant.trustLevel]),
  )
  const capabilityIdByKey = new Map(
    capabilities.map((capability) => [
      `${capability.connectorType}:${capability.name}`,
      capability.id,
    ]),
  )

  const tools = capabilities.map((capability) => {
    const capabilityId =
      capabilityIdByKey.get(`${capability.connectorType}:${capability.name}`) ??
      ''
    const { trust, visible } = resolveEffectiveTrust({
      toolTrust: toolGrantByCapability.get(capabilityId) as
        | PermissionTrustLevel
        | undefined,
      connectionTrust: connectionGrantByConnector.get(
        capability.connectorType,
      ) as PermissionTrustLevel | undefined,
      riskClass: capability.riskClass,
    })
    return {
      connector_id: capability.connectorType,
      tool_name: capability.name,
      risk_class: capability.riskClass,
      trust,
      granted: toolGrantByCapability.has(capabilityId),
      visible,
    }
  })

  return Result.ok({
    connections: [...connectionGrantByConnector.entries()].map(
      ([connector_id, trust]) => ({
        connector_id,
        trust,
        granted: true,
        visible: (trust as PermissionTrustLevel) !== 'ask',
      }),
    ),
    tools,
  })
}
