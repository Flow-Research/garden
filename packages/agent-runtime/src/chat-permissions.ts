import { connectorRegistry } from '@garden/connectors'
import {
  evaluateToolPermission,
  type AgentPermissions,
} from '@garden/core/agents/permissions'

/**
 * Splits a runtime tool name such as `tool_github_add_issue_comment` into its
 * connector and bare tool name. Returns null for non-connector tools.
 */
export function connectorToolForName(runtimeToolName: string): {
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

/** Applies {@link evaluateToolPermission} to a runtime tool name. */
export function evaluateRuntimeToolPermission(
  permissions: AgentPermissions | null,
  runtimeToolName: string,
) {
  const connectorTool = connectorToolForName(runtimeToolName)
  return evaluateToolPermission(permissions, {
    toolName: connectorTool?.toolName ?? runtimeToolName,
    runtimeToolName,
    connectorId: connectorTool?.connectorId ?? null,
  })
}

export function isChatToolAllowed(
  permissions: AgentPermissions | null,
  runtimeToolName: string,
): boolean {
  return evaluateRuntimeToolPermission(permissions, runtimeToolName).allowed
}
