import { eq } from 'drizzle-orm'
import type { getDb, schema } from './db'

type Db = ReturnType<typeof getDb>

function defaultTrustLevelForRisk(riskClass: string | null) {
  switch (riskClass) {
    case 'read':
      return 'auto' as const
    case 'write':
      return 'allow' as const
    default:
      return 'ask' as const
  }
}

export async function bindExistingSkillsToAgent(input: {
  db: Db
  schema: typeof schema
  agentId: string
  workspaceId: string
}) {
  const skills = await input.db
    .select({ id: input.schema.skill.id })
    .from(input.schema.skill)
    .where(eq(input.schema.skill.workspaceId, input.workspaceId))

  if (skills.length === 0) return

  await input.db
    .insert(input.schema.agentSkill)
    .values(
      skills.map((skill) => ({
        agentId: input.agentId,
        skillId: skill.id,
        enabled: true,
      })),
    )
    .onConflictDoNothing()
}

export async function bindSkillToWorkspaceAgents(input: {
  db: Db
  schema: typeof schema
  skillId: string
  workspaceId: string
}) {
  const agents = await input.db
    .select({ id: input.schema.agent.id })
    .from(input.schema.agent)
    .where(eq(input.schema.agent.workspaceId, input.workspaceId))

  if (agents.length === 0) return

  await input.db
    .insert(input.schema.agentSkill)
    .values(
      agents.map((agent) => ({
        agentId: agent.id,
        skillId: input.skillId,
        enabled: true,
      })),
    )
    .onConflictDoNothing()
}

export async function bindExistingCapabilitiesToAgent(input: {
  db: Db
  schema: typeof schema
  agentId: string
  grantedBy: string
}) {
  const capabilities = await input.db
    .select({
      id: input.schema.capability.id,
      riskClass: input.schema.capability.riskClass,
    })
    .from(input.schema.capability)

  if (capabilities.length === 0) return

  await input.db
    .insert(input.schema.permissionGrant)
    .values(
      capabilities.map((capability) => ({
        id: crypto.randomUUID(),
        agentId: input.agentId,
        capabilityId: capability.id,
        trustLevel: defaultTrustLevelForRisk(capability.riskClass),
        grantedBy: input.grantedBy,
        grantedAt: new Date(),
        expiresAt: null,
      })),
    )
    .onConflictDoNothing()
}
