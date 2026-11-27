import { eq, sql } from 'drizzle-orm'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { toInvitation } from '@/lib/server/control-plane'
import { acceptInvitationWithSession } from '@/lib/server/invitation-acceptance'
import type {
  InvitationAutoAcceptResult,
  SignupInvitationPreview,
} from '@/lib/invitation-flow'

const invitationInputSchema = z.object({
  invitationId: z.string().uuid(),
})

/**
 * Every export of this module must stay a `createServerFn`. TanStack Start's
 * vite plugin only strips a server module from the browser bundle when all
 * exports are server functions (see route-session.ts); one plain value export
 * ships the module's server imports (db → pg) to the browser. Shared
 * invitation vocabulary lives in `@/lib/invitation-flow` instead.
 */

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

    return acceptInvitationWithSession({
      auth: await appContext.auth.getAuth(),
      db: await appContext.db(),
      requestHeaders: appContext.request.headers,
      session,
      invitationId: data.invitationId,
      forwardResponseHeaders: forwardSetCookieHeaders,
    })
  })

/** Copies Better Auth's Set-Cookie values onto the Start server-fn response. */
function forwardSetCookieHeaders(headers: Headers) {
  const cookies = headers.getSetCookie()
  if (cookies.length > 0) {
    setResponseHeader('set-cookie', cookies)
  }
}
