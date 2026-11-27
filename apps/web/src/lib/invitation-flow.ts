import { z } from 'zod'

/**
 * Client-safe invitation-flow vocabulary shared by routes and server
 * functions. Lives outside `lib/server/invitations.ts` on purpose: TanStack
 * Start only strips a server module from the browser bundle when every export
 * is a server function (see lib/server/route-session.ts transform). Mixing
 * plain value exports into that module shipped its server imports
 * (db → @garden/db/runtime → pg) to the browser, where `pg` crashes module
 * evaluation with "Buffer is not defined". Keep this module free of
 * server-only imports.
 */

export type SignupInvitationPreview = {
  email: string
  id: string
  organizationName?: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired'
  userExists: boolean
} | null

/**
 * Why an invite cannot complete, split so the route can show actionable copy
 * instead of one generic failure. `configuration` covers Better Auth setup
 * drift (for example the email-verification gate tripping again); `temporary`
 * covers transient accept failures worth a retry.
 */
export type InvitationUnavailableReason =
  | 'malformed'
  | 'not_found'
  | 'used'
  | 'canceled'
  | 'rejected'
  | 'expired'
  | 'workspace_full'
  | 'configuration'
  | 'temporary'

export type InvitationAutoAcceptResult =
  | { status: 'accepted'; workspaceId: string }
  | {
      status: 'email_mismatch'
      invitationEmail: string
      organizationName?: string
      sessionEmail: string
    }
  | {
      status: 'unavailable'
      reason: InvitationUnavailableReason
      message: string
    }

export const invitationUnavailableMessages: Record<
  InvitationUnavailableReason,
  string
> = {
  malformed:
    'This invitation link is malformed. Ask an admin to resend the invite.',
  not_found:
    'Invitation not found. It may have been removed — ask an admin for a new invite.',
  used: 'This invitation was already accepted. Sign in with the invited account to open the workspace.',
  canceled:
    'This invitation was canceled. Ask an admin for a new invite if you still need access.',
  rejected:
    'This invitation was declined. Ask an admin for a new invite if this was a mistake.',
  expired:
    'This invitation has expired. Ask an admin for a fresh invite — resending extends the same invite.',
  workspace_full:
    'This workspace has reached its member limit. Ask an admin to make room before inviting you again.',
  configuration:
    'This workspace cannot accept invitations right now because of a configuration problem. Ask an admin to contact Garden support.',
  temporary:
    'We could not accept this invitation right now. Try again in a moment, or ask an admin for a fresh invite.',
}

/** Extracts a Garden invitation id from a sanitized internal redirect target. */
export function invitationIdFromRedirect(redirectTarget: string | undefined) {
  if (!redirectTarget) return null
  const internalBase = new URL('https://garden.local')
  const url = new URL(redirectTarget, internalBase)
  if (url.origin !== internalBase.origin) return null
  const match = /^\/invitations\/([^/]+)$/.exec(url.pathname)
  const id = match?.[1]
  if (!id || !z.string().uuid().safeParse(id).success) return null
  return id
}
