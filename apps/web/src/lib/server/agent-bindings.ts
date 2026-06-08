import { defaultTrustLevelForRisk } from '@garden/connectors/capabilities'
import type { getDb, schema } from './db'

type Db = ReturnType<typeof getDb>

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
