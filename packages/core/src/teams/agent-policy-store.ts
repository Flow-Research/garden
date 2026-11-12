import { and, eq, isNotNull } from 'drizzle-orm'
import type { GardenDatabase } from '@garden/db'
import * as schema from '@garden/db/schema'
import {
  TeamAgentPolicySchema,
  combineTeamAgentPolicies,
  type EffectiveTeamAgentPolicy,
  type TeamAgentPolicySource,
} from './agent-policy'

/**
 * Loads the stored policy of every Team the acting user belongs to in one
 * workspace and folds them strictest-wins. The runtime calls this per turn
 * and per approval decision instead of caching, so a saved policy applies to
 * the next tool decision.
 *
 * A row that fails `TeamAgentPolicySchema` is a write-path bug, not a user
 * choice. It is treated as the strictest policy (no areas, every blockable
 * class blocked, every class needing approval) so corrupt data never grants
 * more than the admin chose, mirroring `UNPARSEABLE_PERMISSIONS_FALLBACK`.
 */
export async function loadTeamAgentPolicyForUser(
  db: GardenDatabase,
  args: { workspaceId: string; userId: string },
): Promise<EffectiveTeamAgentPolicy> {
  const rows = await db
    .select({
      teamId: schema.team.id,
      teamName: schema.team.name,
      policy: schema.teamAgentPolicy.policy,
    })
    .from(schema.teamMember)
    .innerJoin(
      schema.team,
      and(
        eq(schema.team.id, schema.teamMember.teamId),
        eq(schema.team.workspaceId, schema.teamMember.workspaceId),
      ),
    )
    .innerJoin(
      schema.teamAgentPolicy,
      eq(schema.teamAgentPolicy.teamId, schema.team.id),
    )
    .where(
      and(
        eq(schema.teamMember.workspaceId, args.workspaceId),
        eq(schema.teamMember.userId, args.userId),
        isNotNull(schema.teamMember.userId),
      ),
    )
  const sources = rows.map((row): TeamAgentPolicySource => {
    const parsed = TeamAgentPolicySchema.safeParse(row.policy)
    return {
      teamId: row.teamId,
      teamName: row.teamName,
      policy: parsed.success
        ? parsed.data
        : {
            allowed_areas: [],
            blocked_risk_classes: ['send_external', 'destructive'],
            blocked_connector_ids: [],
            approval_required: ['write', 'send_external', 'destructive'],
          },
    }
  })
  return combineTeamAgentPolicies(sources)
}
