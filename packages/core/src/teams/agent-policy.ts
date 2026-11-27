import { z } from 'zod'
import type { ToolPermissionDecision } from '../agents/permissions'

/**
 * Areas group agent tools so a workspace admin can switch a whole family off
 * for one Team's members. The design's Chats and Home areas are not here: the
 * agent lives in chat, and Home has no agent tools.
 */
export const TEAM_AGENT_AREAS = [
  'tasks',
  'knowledge',
  'inbox',
  'connections',
  'workflows',
  'skills',
] as const
export const TeamAgentAreaSchema = z.enum(TEAM_AGENT_AREAS)
export type TeamAgentArea = z.infer<typeof TeamAgentAreaSchema>

/** Risk classes a Team rule can name. `read` is never restricted. */
export const TeamRiskClassSchema = z.enum([
  'write',
  'send_external',
  'destructive',
])
export type TeamRiskClass = z.infer<typeof TeamRiskClassSchema>

export const TeamBlockableRiskClassSchema = TeamRiskClassSchema.exclude([
  'write',
])
export type TeamBlockableRiskClass = z.infer<
  typeof TeamBlockableRiskClassSchema
>

/**
 * One Team's ceiling on what agents may do for its members. Strict so an
 * unknown key, such as a "Coming soon" design control, fails validation
 * instead of being stored and silently ignored.
 */
export const TeamAgentPolicySchema = z.strictObject({
  allowed_areas: z.array(TeamAgentAreaSchema),
  blocked_risk_classes: z.array(TeamBlockableRiskClassSchema),
  blocked_connector_ids: z.array(z.string().min(1)),
  approval_required: z.array(TeamRiskClassSchema),
})
export type TeamAgentPolicy = z.infer<typeof TeamAgentPolicySchema>

/** The policy a Team has before an admin saves one: no limits. */
export const DEFAULT_TEAM_AGENT_POLICY: TeamAgentPolicy = {
  allowed_areas: [...TEAM_AGENT_AREAS],
  blocked_risk_classes: [],
  blocked_connector_ids: [],
  approval_required: [],
}

/** API response for `GET`/`PUT /api/teams/:teamId/agent-policy`. */
export const TeamAgentPolicyResponseSchema = z.object({
  team_id: z.string(),
  policy: TeamAgentPolicySchema,
  can_edit: z.boolean(),
  updated_at: z.string().nullable(),
})
export type TeamAgentPolicyResponse = z.infer<
  typeof TeamAgentPolicyResponseSchema
>

export type TeamRef = { teamId: string; teamName: string }

/** A stored policy and the Team it belongs to, as the runtime loads it. */
export type TeamAgentPolicySource = TeamRef & { policy: TeamAgentPolicy }

/** Every applicable Team policy folded into one strictest-wins ceiling. */
export type EffectiveTeamAgentPolicy = {
  blockedAreas: ReadonlyMap<TeamAgentArea, TeamRef>
  blockedRiskClasses: ReadonlyMap<TeamBlockableRiskClass, TeamRef>
  blockedConnectorIds: ReadonlyMap<string, TeamRef>
  /** Teams requiring approval for each class, ordered by Team name. */
  approvalTeams: ReadonlyMap<TeamRiskClass, readonly TeamRef[]>
}

/** What a Team rule needs to know about a tool to decide on it. */
export type TeamPolicyToolTarget = {
  area: TeamAgentArea | null
  connectorId: string | null
  riskClass: string | null
}

/**
 * Folds the policies of every Team the acting user belongs to. A Team policy
 * is a ceiling, so the result is the union of blocks and approvals: a user on
 * two Teams gets the stricter of both. Sources are sorted by Team name so the
 * Team named on an approval is stable across turns.
 */
export function combineTeamAgentPolicies(
  sources: readonly TeamAgentPolicySource[],
): EffectiveTeamAgentPolicy {
  const blockedAreas = new Map<TeamAgentArea, TeamRef>()
  const blockedRiskClasses = new Map<TeamBlockableRiskClass, TeamRef>()
  const blockedConnectorIds = new Map<string, TeamRef>()
  const approvalTeams = new Map<TeamRiskClass, TeamRef[]>()
  const ordered = [...sources].sort(
    (left, right) =>
      left.teamName.localeCompare(right.teamName) ||
      left.teamId.localeCompare(right.teamId),
  )
  for (const source of ordered) {
    const team = { teamId: source.teamId, teamName: source.teamName }
    const allowed = new Set(source.policy.allowed_areas)
    for (const area of TEAM_AGENT_AREAS) {
      if (!allowed.has(area) && !blockedAreas.has(area)) {
        blockedAreas.set(area, team)
      }
    }
    for (const riskClass of source.policy.blocked_risk_classes) {
      if (!blockedRiskClasses.has(riskClass)) {
        blockedRiskClasses.set(riskClass, team)
      }
    }
    for (const connectorId of source.policy.blocked_connector_ids) {
      if (!blockedConnectorIds.has(connectorId)) {
        blockedConnectorIds.set(connectorId, team)
      }
    }
    for (const riskClass of new Set(source.policy.approval_required)) {
      approvalTeams.set(riskClass, [
        ...(approvalTeams.get(riskClass) ?? []),
        team,
      ])
    }
  }
  return {
    blockedAreas,
    blockedRiskClasses,
    blockedConnectorIds,
    approvalTeams,
  }
}

/** The ceiling for a user on no Team, or with no stored policies. */
export const NO_TEAM_AGENT_POLICY = combineTeamAgentPolicies([])

/**
 * Decides whether a tool exists for the acting user under their Teams'
 * policies. It only removes: callers still apply the agent's own permissions,
 * so a Team policy never grants a tool the agent lacks. An untagged tool has
 * no area and is always allowed by the area rule.
 */
export function evaluateTeamToolPolicy(
  effective: EffectiveTeamAgentPolicy,
  tool: TeamPolicyToolTarget,
): ToolPermissionDecision {
  const areaTeam = tool.area ? effective.blockedAreas.get(tool.area) : undefined
  if (areaTeam) {
    return {
      allowed: false,
      reason: `${tool.area} tools are turned off by ${areaTeam.teamName} Team policy.`,
    }
  }
  const connectorTeam = tool.connectorId
    ? effective.blockedConnectorIds.get(tool.connectorId)
    : undefined
  if (connectorTeam) {
    return {
      allowed: false,
      reason: `The ${tool.connectorId} connector is turned off by ${connectorTeam.teamName} Team policy.`,
    }
  }
  const riskTeam =
    tool.riskClass === 'send_external' || tool.riskClass === 'destructive'
      ? effective.blockedRiskClasses.get(tool.riskClass)
      : undefined
  if (riskTeam) {
    return {
      allowed: false,
      reason: `${tool.riskClass} actions are blocked by ${riskTeam.teamName} Team policy.`,
    }
  }
  return { allowed: true }
}

/**
 * Names the Team whose rule holds a risk class for approval, plus any other
 * Teams with the same rule. Null when no applicable Team requires approval.
 */
export function teamApprovalRequirement(
  effective: EffectiveTeamAgentPolicy,
  riskClass: string,
): { team: TeamRef; otherTeams: readonly TeamRef[] } | null {
  const parsed = TeamRiskClassSchema.safeParse(riskClass)
  if (!parsed.success) return null
  const [team, ...otherTeams] = effective.approvalTeams.get(parsed.data) ?? []
  return team ? { team, otherTeams } : null
}
