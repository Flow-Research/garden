import { eq } from 'drizzle-orm'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { toInvitation } from '@/lib/server/control-plane'

export type SignupInvitationPreview = {
  email: string
  id: string
  organizationName?: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
} | null

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
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/**
 * Loads minimal invite data for signup seeding without requiring auth. The id is
 * already a bearer capability from the email link, and this returns only enough
 * data to prefill and lock the email field so the invite can be accepted without
 * a second confirmation hop after account creation.
 */
export const getSignupInvitationPreview = createServerFn({ method: 'GET' })
  .inputValidator((data: { invitationId: string }) => data)
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

    return {
      email: invitation.email,
      id: invitation.id,
      organizationName: invitation.organizationName,
      status: toSignupInvitationStatus(invitation.status),
    }
  })

function toSignupInvitationStatus(status: string) {
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
  .inputValidator((data: { invitationId: string }) => data)
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
    const result = await auth.api.acceptInvitation({
      headers: appContext.request.headers,
      body: {
        invitationId: data.invitationId,
      },
    })

    return {
      status: 'accepted',
      workspaceId: result.member.organizationId,
    }
  })
