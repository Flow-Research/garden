import { connectorRegistry } from '@garden/connectors'
import { getConnectorByExecutorSlug } from '@garden/connectors/registry'
import {
  evaluateToolPermission,
  type AgentPermissions,
  type ToolPermissionDecision,
} from '@garden/core/agents/permissions'
import {
  evaluateTeamToolPolicy,
  type EffectiveTeamAgentPolicy,
  type TeamAgentArea,
  type TeamPolicyToolTarget,
} from '@garden/core/teams/agent-policy'
import { extractExecutorToolRefsFromInput } from './executor-codemode'
import { EXECUTOR_TOOL_KEY_PREFIX } from './runtime-mcp-controller'

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

/**
 * Area tag for every native agent tool a Team policy can switch off. Connector
 * and Executor tools are tagged `connections` by name prefix instead. A tool
 * missing from this registry is untagged and always allowed by area rules.
 *
 * Issue-run lifecycle tools (`post_comment`, `update_plan`, `mark_blocked`,
 * and similar) are deliberately untagged: they are how a run reports back, so
 * removing them would strand the run rather than limit the agent. Garden has
 * no agent tools for Inbox or Workflows today, so those areas tag nothing yet.
 */
export const AGENT_TOOL_AREAS = {
  create_issue: 'tasks',
  assign_issue: 'tasks',
  read_issue: 'tasks',
  list_issues: 'tasks',
  update_issue_status: 'tasks',
  post_issue_comment: 'tasks',
  read_run: 'tasks',
  add_to_brain: 'knowledge',
  brain_link: 'knowledge',
  brain_neighborhood: 'knowledge',
  brain_observe_mention: 'knowledge',
  brain_read_file: 'knowledge',
  brain_search: 'knowledge',
  activate_skill: 'skills',
  read_skill_resource: 'skills',
  run_skill_script: 'skills',
} as const satisfies Record<string, TeamAgentArea>

/**
 * Describes a runtime tool to Team policy: its area, owning connector, and
 * risk class from the connector registry. Executor's tool is one entry point
 * for many connectors, so only its area is known before the call.
 */
export function teamPolicyTargetForTool(
  runtimeToolName: string,
): TeamPolicyToolTarget {
  if (runtimeToolName.startsWith(EXECUTOR_TOOL_KEY_PREFIX)) {
    return { area: 'connections', connectorId: null, riskClass: null }
  }
  const connectorTool = connectorToolForName(runtimeToolName)
  if (connectorTool) {
    const connector = connectorRegistry.find(
      (entry) => entry.id === connectorTool.connectorId,
    )
    return {
      area: 'connections',
      connectorId: connectorTool.connectorId,
      riskClass: connector?.tools[connectorTool.toolName]?.riskClass ?? null,
    }
  }
  const area =
    (AGENT_TOOL_AREAS as Record<string, TeamAgentArea>)[runtimeToolName] ?? null
  return { area, connectorId: null, riskClass: null }
}

/** Whether a tool exists for the acting user under their Teams' policies. */
export function isTeamToolAllowed(
  teamPolicy: EffectiveTeamAgentPolicy,
  runtimeToolName: string,
): boolean {
  return evaluateTeamToolPolicy(
    teamPolicy,
    teamPolicyTargetForTool(runtimeToolName),
  ).allowed
}

/**
 * Applies the agent's permissions and the acting user's Team policies to a
 * runtime tool name. A tool exists only when both allow it, so a Team policy
 * removes tools but never grants one the agent lacks.
 */
export function evaluateRuntimeToolPermission(
  permissions: AgentPermissions | null,
  teamPolicy: EffectiveTeamAgentPolicy,
  runtimeToolName: string,
): ToolPermissionDecision {
  const teamDecision = evaluateTeamToolPolicy(
    teamPolicy,
    teamPolicyTargetForTool(runtimeToolName),
  )
  if (!teamDecision.allowed) return teamDecision
  const connectorTool = connectorToolForName(runtimeToolName)
  return evaluateToolPermission(permissions, {
    toolName: connectorTool?.toolName ?? runtimeToolName,
    runtimeToolName,
    connectorId: connectorTool?.connectorId ?? null,
  })
}

export function isChatToolAllowed(
  permissions: AgentPermissions | null,
  teamPolicy: EffectiveTeamAgentPolicy,
  runtimeToolName: string,
): boolean {
  return evaluateRuntimeToolPermission(permissions, teamPolicy, runtimeToolName)
    .allowed
}

/**
 * Checks the connectors an Executor call names against Team policy. The
 * Executor tool is visible whenever the Connections area is on, so a blocked
 * connector or risk class can only be caught once the call's code names it.
 */
export function evaluateExecutorCallTeamPolicy(
  teamPolicy: EffectiveTeamAgentPolicy,
  input: unknown,
): ToolPermissionDecision {
  for (const ref of extractExecutorToolRefsFromInput(input)) {
    const connector = getConnectorByExecutorSlug(ref.executorSlug)
    if (!connector) continue
    const decision = evaluateTeamToolPolicy(teamPolicy, {
      area: 'connections',
      connectorId: connector.id,
      riskClass: connector.tools[ref.tool]?.riskClass ?? null,
    })
    if (!decision.allowed) return decision
  }
  return { allowed: true }
}
