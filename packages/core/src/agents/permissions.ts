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

function parsePermissions(value: unknown) {
  const parsed = AgentPermissionsSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_AGENT_PERMISSIONS
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
