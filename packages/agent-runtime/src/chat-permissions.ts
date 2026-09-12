import { connectorRegistry } from '@garden/connectors'
import type { AgentPermissions } from '@garden/core/agents/permissions'

function chatConnectorToolForName(runtimeToolName: string): {
  connectorId: string
  toolName: string
} | null {
  for (const connector of connectorRegistry) {
    const prefix = `tool_${connector.id.replace(/-/g, '')}_`
    if (runtimeToolName.startsWith(prefix)) {
      return {
        connectorId: connector.id,
        toolName: runtimeToolName.slice(prefix.length),
      }
    }
  }
  return null
}

export function isChatToolAllowed(
  permissions: AgentPermissions | null,
  runtimeToolName: string,
): boolean {
  if (!permissions || permissions.full_access) return true

  const connectorTool = chatConnectorToolForName(runtimeToolName)
  const toolName = connectorTool?.toolName ?? runtimeToolName

  if (
    !permissions.allowed_tools.includes(toolName) &&
    !permissions.allowed_tools.includes(runtimeToolName)
  ) {
    return false
  }

  if (
    connectorTool &&
    !permissions.allowed_connectors.includes(connectorTool.connectorId)
  ) {
    return false
  }

  return true
}
