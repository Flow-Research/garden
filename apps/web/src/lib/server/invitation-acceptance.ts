import { and, eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { createLogger } from '@garden/observability/console'
import type { GardenAuth, GardenAuthSession } from '@/lib/server/context'
import { schema, type Db } from '@/lib/server/db'
import { toInvitation } from '@/lib/server/control-plane'
import {
  invitationUnavailableMessages,
  type InvitationAutoAcceptResult,
  type InvitationUnavailableReason,
} from '@/lib/invitation-flow'

const logger = createLogger('invitations')

class InvitationAcceptError extends TaggedError('InvitationAcceptError')<{
  cause: unknown
  message: string
}>() {}

/**
 * Finds existing organization membership before or after Better Auth invite
 * acceptance. PostHog showed duplicate `member` inserts from `/invitations/*`:
 * Better Auth updates an invite to accepted, then inserts a member, so a repeat
 * accept can throw on Garden's unique organization/user index. Keeping this
 * lookup local makes invite accept idempotent while still using Better Auth for
 * normal session cookie updates. References: Better Auth `acceptInvitation` in
 * `crud-invites.mjs` and better-result Result docs.
 */
async function findInvitationMembership(args: {
  db: Db
  organizationId: string
  userId: string
}) {
  const [membership] = await args.db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, args.organizationId),
        eq(schema.member.userId, args.userId),
      ),
    )
    .limit(1)

  return membership ?? null
}

/**
 * Marks an invite consumed when membership already exists. Better Auth accepts
 * pending invites by mutating invitation status before inserting `member`; when
 * the member already exists, that insert can 500 and leave product UX broken.
 * This helper preserves the intended after-state for repeat clicks and races:
 * invitation is accepted, active organization is refreshed, and the route can
 * redirect to the workspace instead of showing an error. The status update is
 * restricted to rows still `pending` so a concurrent cancelInvitation can never
 * be resurrected back to accepted by this recovery path.
 */
async function activateExistingInvitationMembership(args: {
  auth: GardenAuth
  db: Db
  headers: Headers
  invitationId: string
  organizationId: string
  forwardResponseHeaders?: (headers: Headers) => void
}) {
  await args.db
    .update(schema.invitation)
    .set({ status: 'accepted' })
    .where(
      and(
        eq(schema.invitation.id, args.invitationId),
        eq(schema.invitation.status, 'pending'),
      ),
    )

  await activateWorkspace(args)
}

/** Sets Better Auth's active org and forwards the refreshed session cookie (server-side auth.api calls don't reach the browser otherwise). */
async function activateWorkspace(args: {
  auth: GardenAuth
  headers: Headers
  organizationId: string
  forwardResponseHeaders?: (headers: Headers) => void
}) {
  const result = await Result.tryPromise({
    try: async () =>
      (await args.auth.api.setActiveOrganization({
        headers: args.headers,
        body: { organizationId: args.organizationId },
        returnHeaders: true,
      })) as { headers: Headers; response: unknown },
    catch: (cause) => cause,
  })

  if (result.isErr()) {
    logger.error('invitation.activate_workspace_failed', {
      organizationId: args.organizationId,
      errorMessage:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    })
    return
  }

  if (result.value.headers.getSetCookie().length > 0) {
    args.forwardResponseHeaders?.(result.value.headers)
  }
}

/** Reads the machine code Better Auth attaches to thrown APIErrors. */
function readApiErrorCode(cause: unknown) {
  if (cause && typeof cause === 'object' && 'body' in cause) {
    const body = (cause as { body?: { code?: unknown } }).body
    if (body && typeof body.code === 'string') return body.code
  }
  return undefined
}

/**
 * Maps Better Auth accept failures to product outcomes. Source of codes:
 * better-auth 1.6.26 organization error-codes.mjs and the acceptInvitation
 * route in crud-invites.mjs.
 */
function reasonFromAcceptError(cause: unknown): InvitationUnavailableReason {
  switch (readApiErrorCode(cause)) {
    case 'INVITATION_NOT_FOUND':
      return 'not_found'
    case 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED':
      return 'workspace_full'
    case 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION':
      return 'configuration'
    default:
      return 'temporary'
  }
}

/**
 * Core invite acceptance, exported so integration tests can drive it with a
 * real Better Auth instance and session cookie against isolated Postgres.
 * Order matters: membership is checked before invitation status so repeat
 * clicks on an already-accepted link reopen the workspace instead of failing,
 * while canceled/expired invites still stop sessions that never joined.
 */
export async function acceptInvitationWithSession(args: {
  auth: GardenAuth
  db: Db
  requestHeaders: Headers
  session: NonNullable<GardenAuthSession>
  invitationId: string
  forwardResponseHeaders?: (headers: Headers) => void
}): Promise<InvitationAutoAcceptResult> {
  const { db, session } = args
  const [row] = await db
    .select({
      invitation: schema.invitation,
      organizationName: schema.organization.name,
    })
    .from(schema.invitation)
    .leftJoin(
      schema.organization,
      eq(schema.organization.id, schema.invitation.organizationId),
    )
    .where(eq(schema.invitation.id, args.invitationId))
    .limit(1)

  if (!row) {
    return {
      status: 'unavailable',
      reason: 'not_found',
      message: invitationUnavailableMessages.not_found,
    }
  }

  const invitation = toInvitation({
    ...row.invitation,
    organizationName: row.organizationName,
  })

  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
    return {
      status: 'email_mismatch',
      invitationEmail: invitation.email,
      organizationName: invitation.organizationName,
      sessionEmail: session.user.email,
    }
  }

  const existingMembership = await findInvitationMembership({
    db,
    organizationId: invitation.organizationId,
    userId: session.user.id,
  })

  if (existingMembership) {
    await activateExistingInvitationMembership({
      auth: args.auth,
      db,
      headers: args.requestHeaders,
      invitationId: args.invitationId,
      organizationId: invitation.organizationId,
      forwardResponseHeaders: args.forwardResponseHeaders,
    })

    return {
      status: 'accepted',
      workspaceId: invitation.organizationId,
    }
  }

  if (invitation.status !== 'pending') {
    const reason =
      invitation.status === 'accepted'
        ? 'used'
        : invitation.status === 'canceled'
          ? 'canceled'
          : 'rejected'
    return {
      status: 'unavailable',
      reason,
      message: invitationUnavailableMessages[reason],
    }
  }

  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    return {
      status: 'unavailable',
      reason: 'expired',
      message: invitationUnavailableMessages.expired,
    }
  }

  const acceptResult = await Result.tryPromise({
    try: async () =>
      (await args.auth.api.acceptInvitation({
        headers: args.requestHeaders,
        body: {
          invitationId: args.invitationId,
        },
      })) as { member: { organizationId: string } },
    catch: (cause) =>
      new InvitationAcceptError({
        cause,
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to accept invitation.',
      }),
  })

  return await acceptResult.match({
    ok: async (result): Promise<InvitationAutoAcceptResult> => {
      await activateWorkspace({
        auth: args.auth,
        headers: args.requestHeaders,
        organizationId: result.member.organizationId,
        forwardResponseHeaders: args.forwardResponseHeaders,
      })

      return {
        status: 'accepted' as const,
        workspaceId: result.member.organizationId,
      }
    },
    err: async (error): Promise<InvitationAutoAcceptResult> => {
      const recoveredMembership = await findInvitationMembership({
        db,
        organizationId: invitation.organizationId,
        userId: session.user.id,
      })

      if (recoveredMembership) {
        await activateExistingInvitationMembership({
          auth: args.auth,
          db,
          headers: args.requestHeaders,
          invitationId: args.invitationId,
          organizationId: invitation.organizationId,
          forwardResponseHeaders: args.forwardResponseHeaders,
        })

        return {
          status: 'accepted' as const,
          workspaceId: invitation.organizationId,
        }
      }

      const reason = reasonFromAcceptError(error.cause)
      logger.error('invitation.accept_failed', {
        invitationId: args.invitationId,
        organizationId: invitation.organizationId,
        reason,
        errorMessage: error.message,
        errorCode: readApiErrorCode(error.cause) ?? null,
      })

      return {
        status: 'unavailable' as const,
        reason,
        message: invitationUnavailableMessages[reason],
      }
    },
  })
}
