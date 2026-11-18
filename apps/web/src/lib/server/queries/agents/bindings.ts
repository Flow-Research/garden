import { defaultTrustLevelForRisk } from '@garden/connectors/capabilities'
import { schema, type Db } from '@/lib/server/db'

/** Seeds default-trust permission grants for every known capability onto an agent. */
export async function bindExistingCapabilitiesToAgent(input: {
  db: Pick<Db, 'select' | 'insert'>
  agentId: string
  grantedBy: string
}) {
  const capabilities = await input.db
    .select({
      id: schema.capability.id,
      riskClass: schema.capability.riskClass,
    })
    .from(schema.capability)

  if (capabilities.length === 0) return

  await input.db
    .insert(schema.permissionGrant)
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
