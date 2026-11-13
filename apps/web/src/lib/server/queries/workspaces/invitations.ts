import { and, eq, sql } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Finds a pending workspace invitation by email (case-insensitive).
 * Used by the invite resend path on `POST /api/workspaces/$id/members`.
 */
export async function findPendingInvitationByEmail(
  db: Db,
  input: { workspaceId: string; email: string },
) {
  const [existing] = await db
    .select()
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, input.workspaceId),
        sql`lower(${schema.invitation.email}) = lower(${input.email})`,
        eq(schema.invitation.status, 'pending'),
      ),
    )
    .limit(1)
  return existing ?? null
}

/**
 * Extends a pending invitation's expiry. Returns null when the row is gone.
 */
export async function updatePendingInvitationExpiresAt(
  db: Db,
  input: { invitationId: string; expiresAt: Date },
) {
  const [updated] = await db
    .update(schema.invitation)
    .set({ expiresAt: input.expiresAt })
    .where(
      and(
        eq(schema.invitation.id, input.invitationId),
        eq(schema.invitation.status, 'pending'),
      ),
    )
    .returning({ id: schema.invitation.id })
  return updated ?? null
}

/**
 * Rolls back an invitation expiry after a failed resend email, matching the
 * previous expiry and the stamp we just wrote so a concurrent update is not
 * clobbered.
 */
export async function revertPendingInvitationExpiresAt(
  db: Db,
  input: {
    invitationId: string
    previousExpiresAt: Date
    stampedExpiresAt: Date
  },
) {
  await db
    .update(schema.invitation)
    .set({ expiresAt: input.previousExpiresAt })
    .where(
      and(
        eq(schema.invitation.id, input.invitationId),
        eq(schema.invitation.status, 'pending'),
        eq(schema.invitation.expiresAt, input.stampedExpiresAt),
      ),
    )
}
