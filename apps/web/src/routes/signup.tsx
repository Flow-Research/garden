import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getRouteSession } from '@/lib/server/route-session'
import {
  getSignupInvitationPreview,
  invitationIdFromRedirect,
  type SignupInvitationPreview,
} from '@/lib/server/invitations'

export const Route = createFileRoute('/signup')({
  validateSearch: (search) => ({
    redirect:
      typeof search.redirect === 'string'
        ? sanitizeRedirectTarget(search.redirect)
        : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const session = await getRouteSession()
    if (!session) return

    throw redirect({
      href: search.redirect ?? '/workspace',
    })
  },
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ deps }) => {
    const invitationId = invitationIdFromRedirect(deps.redirect)
    if (!invitationId) return null

    const invitation = await getSignupInvitationPreview({
      data: { invitationId },
    })
    if (invitation?.status === 'pending' && invitation.userExists) {
      throw redirect({
        to: '/login',
        search: { redirect: deps.redirect },
      })
    }

    return invitation
  },
  component: SignUpRoute,
})

function SignUpRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const invitation = Route.useLoaderData()
  const invitationIsPending = invitation?.status === 'pending'
  const invitationStatusMessage = getInvitationStatusMessage(invitation)

  return (
    <LoginPage
      initialMode="signup"
      initialEmail={invitationIsPending ? invitation.email : undefined}
      lockedEmail={invitationIsPending}
      invitationStatusMessage={invitationStatusMessage}
      invitationWorkspaceName={
        invitationIsPending ? invitation.organizationName : undefined
      }
      onSuccess={() =>
        void navigate({ href: search.redirect ?? '/workspace', replace: true })
      }
    />
  )
}

/**
 * Explains dead invitation links before account creation. The previous signup
 * preview only highlighted pending invites, so expired or already-used links
 * looked like a normal signup and failed only after authentication redirected
 * back to invite acceptance.
 */
function getInvitationStatusMessage(invitation: SignupInvitationPreview) {
  if (!invitation || invitation.status === 'pending') return undefined
  const target = invitation.organizationName
    ? ` for ${invitation.organizationName}`
    : ''

  switch (invitation.status) {
    case 'expired':
      return `This invitation${target} expired. Ask an admin for a fresh invite before creating an account.`
    case 'accepted':
      return `This invitation${target} was already accepted. Sign in with the invited account instead.`
    case 'rejected':
    case 'canceled':
      return `This invitation${target} is no longer available. Ask an admin for a new invite.`
  }
}
