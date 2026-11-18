import { eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Capability + grant rows for agent access review. Before: inline in
 * `routes/api/agents/$id/access.ts`. After: queries only. Capability load
 * stays global (no workspace filter) to match prior behavior.
 */
export async function listAllCapabilities(db: Db) {
  return await db
    .select({
      id: schema.capability.id,
      connectorType: schema.capability.connectorType,
      name: schema.capability.name,
      riskClass: schema.capability.riskClass,
    })
    .from(schema.capability)
}

export async function listAgentPermissionGrants(db: Db, agentId: string) {
  return await db
    .select({
      capabilityId: schema.permissionGrant.capabilityId,
      trustLevel: schema.permissionGrant.trustLevel,
    })
    .from(schema.permissionGrant)
    .where(eq(schema.permissionGrant.agentId, agentId))
}

export async function listAgentConnectionGrants(db: Db, agentId: string) {
  return await db
    .select({
      connectorId: schema.connectionGrant.connectorId,
      trustLevel: schema.connectionGrant.trustLevel,
    })
    .from(schema.connectionGrant)
    .where(eq(schema.connectionGrant.agentId, agentId))
}
