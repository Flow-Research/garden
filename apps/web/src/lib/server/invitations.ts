import { and, eq, sql } from 'drizzle-orm'
import { redirect } from '@tanstack/react-router'
import { Result, TaggedError } from 'better-result'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAppRequestContext, type GardenAuth } from '@/lib/server/context'
import { schema, type Db } from '@/lib/server/db'
import { toInvitation } from '@/lib/server/control-plane'

export type SignupInvitationPreview = {
  email: string
  id: string
  organizationName?: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired'
  userExists: boolean
} | null

const invitationInputSchema = z.object({
  invitationId: z.string().min(1),
})

class InvitationAcceptError extends TaggedError('InvitationAcceptError')<{
  cause: unknown
  message: string
}>() {}

export type InvitationAutoAcceptResult =
  | { status: 'accepted'; workspaceId: string }
  | {
      status: 'email_mismatch'
      invitationEmail: string
      organizationName?: string
      sessionEmail: string
    }
  | { status: 'unavailable'; message: string }

/** Extracts a Garden invitation id from a sanitized internal redirect target. */
export function invitationIdFromRedirect(redirectTarget: string | undefined) {
  if (!redirectTarget) return null
  const url = new URL(redirectTarget, 'https://garden.local')
  const match = /^\/invitations\/([^/]+)$/.exec(url.pathname)
  return match?.[1] ?? null
}

/**
 * Loads minimal invite data for auth routing without requiring a session. Better
 * Auth's organization flow intentionally starts from an invitation ID but still
 * requires an authenticated matching-email session before acceptInvitation runs.
 * That leaves login-vs-signup UX to the app, so this preview checks whether the
 * invited email already has a Garden user and lets routes send the user directly
 * to locked-email sign-in or sign-up instead of making them discover the wrong
 * auth mode after a failed submit. It also marks expired links before account
 * creation so users do not create an account expecting a join that cannot
 * complete. References: Better Auth Organization docs, Accept Invitation section;
 * local better-auth crud-invites.mjs requires session + recipient email match.
 */
export const getSignupInvitationPreview = createServerFn({ method: 'GET' })
  .inputValidator(invitationInputSchema)
  .handler(async ({ context, data }): Promise<SignupInvitationPreview> => {
    const appContext = requireAppRequestContext(context)
    const db = await appContext.db()
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
      .where(eq(schema.invitation.id, data.invitationId))
      .limit(1)

    if (!row) return null
    const invitation = toInvitation({
      ...row.invitation,
      organizationName: row.organizationName,
    })

    const [existingUser] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sql`lower(${schema.user.email}) = lower(${invitation.email})`)
      .limit(1)

    return {
      email: invitation.email,
      id: invitation.id,
      organizationName: invitation.organizationName,
      status:
        new Date(invitation.expiresAt).getTime() <= Date.now()
          ? 'expired'
          : toSignupInvitationStatus(invitation.status),
      userExists: Boolean(existingUser),
    }
  })

function toSignupInvitationStatus(
  status: string,
): Exclude<NonNullable<SignupInvitationPreview>['status'], 'expired'> {
  switch (status) {
    case 'accepted':
    case 'rejected':
    case 'canceled':
      return status
    default:
      return 'pending'
  }
}

/**
 * Finds existing organization membership before or after Better Auth invite
 * acceptance. PostHog showed duplicate `member` inserts from `/invitations/*`:
 * Better Auth updates an invite to accepted, then inserts a member, so a repeat
 * accept can throw on Garden's unique organization/user index. Keeping this
 * lookup local makes invite accept idempotent while still using Better Auth for
 * normal session cookie updates. References: PostHog issue 019ee68c..., Better
 * Auth `acceptInvitation` in `crud-invites.mjs`, and better-result Result docs.
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
 * redirect to the workspace instead of showing an error.
 */
async function activateExistingInvitationMembership(args: {
  auth: GardenAuth
  db: Db
  headers: Headers
  invitationId: string
  organizationId: string
}) {
  await args.db
    .update(schema.invitation)
    .set({ status: 'accepted' })
    .where(eq(schema.invitation.id, args.invitationId))

  await args.auth.api.setActiveOrganization({
    headers: args.headers,
    body: { organizationId: args.organizationId },
  })
}

/**
 * Accepts an invite for the current authenticated user only when the session
 * email matches the invitation email. This removes the redundant consent screen
 * on the email-link happy path while preserving a visible stop for account
 * mismatch, expired, revoked, or already-used invites.
 */
export const acceptInvitationForCurrentUser = createServerFn({ method: 'POST' })
  .inputValidator(invitationInputSchema)
  .handler(async ({ context, data }): Promise<InvitationAutoAcceptResult> => {
    const appContext = requireAppRequestContext(context)
    const session = await appContext.auth.getSession()
    if (!session) {
      throw redirect({
        to: '/login',
        search: { redirect: `/invitations/${data.invitationId}` },
      })
    }

    const db = await appContext.db()
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
      .where(eq(schema.invitation.id, data.invitationId))
      .limit(1)

    if (!row) {
      return { status: 'unavailable', message: 'Invitation not found.' }
    }

    const invitation = toInvitation({
      ...row.invitation,
      organizationName: row.organizationName,
    })

    if (invitation.status !== 'pending') {
      return {
        status: 'unavailable',
        message: `This invitation is ${invitation.status}. Ask an admin for a new invite if you still need access.`,
      }
    }

    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      return {
        status: 'unavailable',
        message: 'This invitation has expired. Ask an admin for a new invite.',
      }
    }

    if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
      return {
        status: 'email_mismatch',
        invitationEmail: invitation.email,
        organizationName: invitation.organizationName,
        sessionEmail: session.user.email,
      }
    }

    const auth = await appContext.auth.getAuth()
    const existingMembership = await findInvitationMembership({
      db,
      organizationId: invitation.organizationId,
      userId: session.user.id,
    })

    if (existingMembership) {
      await activateExistingInvitationMembership({
        auth,
        db,
        headers: appContext.request.headers,
        invitationId: data.invitationId,
        organizationId: invitation.organizationId,
      })

      return {
        status: 'accepted',
        workspaceId: invitation.organizationId,
      }
    }

    const acceptResult = await Result.tryPromise({
      try: async () =>
        (await auth.api.acceptInvitation({
          headers: appContext.request.headers,
          body: {
            invitationId: data.invitationId,
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
      ok: (result) =>
        Promise.resolve({
          status: 'accepted' as const,
          workspaceId: result.member.organizationId,
        }),
      err: async () => {
        const recoveredMembership = await findInvitationMembership({
          db,
          organizationId: invitation.organizationId,
          userId: session.user.id,
        })

        if (recoveredMembership) {
          await activateExistingInvitationMembership({
            auth,
            db,
            headers: appContext.request.headers,
            invitationId: data.invitationId,
            organizationId: invitation.organizationId,
          })

          return {
            status: 'accepted' as const,
            workspaceId: invitation.organizationId,
          }
        }

        return {
          status: 'unavailable' as const,
          message:
            'We could not accept this invitation. Ask an admin for a fresh invite if you still need access.',
        }
      },
    })
  })
