import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

type PermissionTrustLevel = 'auto' | 'allow' | 'ask'

/** Loads a capability row by connector id and tool name. */
export async function getCapabilityByConnectorTool(
  db: Db,
  input: { connectorId: string; toolName: string },
) {
  const [capability] = await db
    .select({
      id: schema.capability.id,
      riskClass: schema.capability.riskClass,
    })
    .from(schema.capability)
    .where(
      and(
        eq(schema.capability.connectorType, input.connectorId),
        eq(schema.capability.name, input.toolName),
      ),
    )
    .limit(1)
  return capability ?? null
}

export async function upsertToolPermissionGrant(
  db: Db,
  input: {
    workspaceId: string
    agentId: string
    capabilityId: string
    connectorId: string
    toolName: string
    trustLevel: PermissionTrustLevel
    grantedBy: string
  },
) {
  const grantedAt = new Date()
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.permissionGrant)
      .values({
        id: crypto.randomUUID(),
        agentId: input.agentId,
        capabilityId: input.capabilityId,
        trustLevel: input.trustLevel,
        grantedBy: input.grantedBy,
        grantedAt,
        expiresAt: null,
      })
      .onConflictDoUpdate({
        target: [
          schema.permissionGrant.agentId,
          schema.permissionGrant.capabilityId,
        ],
        set: {
          trustLevel: input.trustLevel,
          grantedBy: input.grantedBy,
          grantedAt,
          expiresAt: null,
        },
      })
    await tx.insert(schema.activityEvent).values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      subjectType: 'agent',
      subjectId: input.agentId,
      actorType: 'user',
      actorId: input.grantedBy,
      eventType: 'permission.grant.set',
      payload: {
        scope: 'tool',
        connector_id: input.connectorId,
        tool_name: input.toolName,
        trust: input.trustLevel,
      },
    })
  })
}

export async function deleteToolPermissionGrant(
  db: Db,
  input: {
    workspaceId: string
    agentId: string
    connectorId: string
    toolName: string
    actorId: string
  },
) {
  await db.transaction(async (tx) => {
    const [capability] = await tx
      .select({ id: schema.capability.id })
      .from(schema.capability)
      .where(
        and(
          eq(schema.capability.connectorType, input.connectorId),
          eq(schema.capability.name, input.toolName),
        ),
      )
      .limit(1)
    if (!capability) return
    const deleted = await tx
      .delete(schema.permissionGrant)
      .where(
        and(
          eq(schema.permissionGrant.agentId, input.agentId),
          eq(schema.permissionGrant.capabilityId, capability.id),
        ),
      )
      .returning({ id: schema.permissionGrant.id })
    if (deleted.length === 0) return
    await tx.insert(schema.activityEvent).values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      subjectType: 'agent',
      subjectId: input.agentId,
      actorType: 'user',
      actorId: input.actorId,
      eventType: 'permission.grant.deleted',
      payload: {
        scope: 'tool',
        connector_id: input.connectorId,
        tool_name: input.toolName,
      },
    })
  })
}
