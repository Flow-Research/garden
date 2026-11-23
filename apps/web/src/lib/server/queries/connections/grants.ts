import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

type PermissionTrustLevel = 'auto' | 'allow' | 'ask'

/**
 * Connection-level grant upsert/delete + activity events. Before: inline in
 * `routes/api/connections/$connectorId/grant.ts`. After: queries only.
 */
export async function upsertConnectionGrant(
  db: Db,
  input: {
    workspaceId: string
    agentId: string
    connectorId: string
    trustLevel: Exclude<PermissionTrustLevel, 'auto'> | PermissionTrustLevel
    grantedBy: string
  },
) {
  const grantedAt = new Date()
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.connectionGrant)
      .values({
        id: crypto.randomUUID(),
        agentId: input.agentId,
        connectorId: input.connectorId,
        trustLevel: input.trustLevel,
        grantedBy: input.grantedBy,
        grantedAt,
        expiresAt: null,
      })
      .onConflictDoUpdate({
        target: [
          schema.connectionGrant.agentId,
          schema.connectionGrant.connectorId,
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
        scope: 'connection',
        connector_id: input.connectorId,
        trust: input.trustLevel,
      },
    })
  })
}

export async function deleteConnectionGrant(
  db: Db,
  input: {
    workspaceId: string
    agentId: string
    connectorId: string
    actorId: string
  },
) {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.connectionGrant)
      .where(
        and(
          eq(schema.connectionGrant.agentId, input.agentId),
          eq(schema.connectionGrant.connectorId, input.connectorId),
        ),
      )
      .returning({ id: schema.connectionGrant.id })
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
        scope: 'connection',
        connector_id: input.connectorId,
      },
    })
  })
}
