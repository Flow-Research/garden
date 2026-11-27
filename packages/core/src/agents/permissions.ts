import { z } from 'zod'

const ApprovalOverridesSchema = z.object({
  send_external: z.enum(['auto', 'manual']).optional(),
  destructive: z.enum(['auto', 'manual']).optional(),
})

const AgentPermissionsObjectSchema = z.object({
  full_access: z.boolean().default(true),
  allowed_skills: z.array(z.string()).default([]),
  allowed_connectors: z.array(z.string()).default([]),
  allowed_tools: z.array(z.string()).default([]),
  approval_overrides: ApprovalOverridesSchema.default({}),
})

const AgentPermissionsOverrideSchema = z.object({
  full_access: z.boolean().optional(),
  allowed_skills: z.array(z.string()).optional(),
  allowed_connectors: z.array(z.string()).optional(),
  allowed_tools: z.array(z.string()).optional(),
  approval_overrides: ApprovalOverridesSchema.optional(),
})

export const AgentPermissionsSchema = AgentPermissionsObjectSchema.default({
  full_access: true,
  allowed_skills: [],
  allowed_connectors: [],
  allowed_tools: [],
  approval_overrides: {},
})

export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>

export const DEFAULT_AGENT_PERMISSIONS = AgentPermissionsSchema.parse({})

/**
 * Used when stored permissions exist but cannot be parsed. Corrupt settings
 * must not grant more than the admin chose, so they lose full access (and with
 * it every skill) instead of silently falling back to the full-access default.
 */
const UNPARSEABLE_PERMISSIONS_FALLBACK: AgentPermissions = {
  full_access: false,
  allowed_skills: [],
  allowed_connectors: [],
  allowed_tools: [],
  approval_overrides: {},
}

function parsePermissions(value: unknown) {
  // No stored value means the agent was never restricted.
  if (value === null || value === undefined) return DEFAULT_AGENT_PERMISSIONS
  const parsed = AgentPermissionsSchema.safeParse(value)
  return parsed.success ? parsed.data : UNPARSEABLE_PERMISSIONS_FALLBACK
}

export type ToolPermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * The single tool gate for chat, issue runs and automation runs.
 *
 * With full access off, `allowed_tools` and `allowed_connectors` restrict only
 * when they have entries: an empty list means "no limit". The agent settings UI
 * restricts skills and never writes these two lists, so reading empty as "deny
 * everything" would strip every tool from any skill-restricted agent.
 * (`allowed_skills` is different: the UI fills it, and empty means no skills.)
 */
export function evaluateToolPermission(
  permissions: AgentPermissions | null,
  tool: {
    /** Name without any connector prefix, e.g. `add_issue_comment`. */
    toolName: string
    /** Name as registered with the runtime, e.g. `tool_github_add_issue_comment`. */
    runtimeToolName: string
    /** Owning connector for connector tools, otherwise null. */
    connectorId: string | null
  },
): ToolPermissionDecision {
  if (!permissions || permissions.full_access) return { allowed: true }

  const { allowed_tools: allowedTools, allowed_connectors: allowedConnectors } =
    permissions
  if (
    allowedTools.length > 0 &&
    !allowedTools.includes(tool.toolName) &&
    !allowedTools.includes(tool.runtimeToolName)
  ) {
    return {
      allowed: false,
      reason: `Tool ${tool.toolName} is not allowed for this agent.`,
    }
  }

  if (
    tool.connectorId &&
    allowedConnectors.length > 0 &&
    !allowedConnectors.includes(tool.connectorId)
  ) {
    return {
      allowed: false,
      reason: `Connector ${tool.connectorId} is not allowed for this agent.`,
    }
  }

  return { allowed: true }
}

export function derivePermissions(input: {
  agent: { permissions?: unknown }
  issue?: {
    permissionsOverride?: unknown
    permissions_override?: unknown
  } | null
}): AgentPermissions {
  const agentPermissions = parsePermissions(input.agent.permissions)
  const overrideSource =
    input.issue && 'permissionsOverride' in input.issue
      ? input.issue.permissionsOverride
      : input.issue?.permissions_override

  if (!overrideSource) return agentPermissions

  const issueOverride = AgentPermissionsOverrideSchema.safeParse(overrideSource)
  if (!issueOverride.success) return agentPermissions

  return AgentPermissionsSchema.parse({
    ...agentPermissions,
    ...issueOverride.data,
    approval_overrides: {
      ...agentPermissions.approval_overrides,
      ...issueOverride.data.approval_overrides,
    },
  })
}
