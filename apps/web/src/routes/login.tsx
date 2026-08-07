import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getRouteSession } from '@/lib/server/route-session'
import {
  getSignupInvitationPreview,
  invitationIdFromRedirect,
  type SignupInvitationPreview,
} from '@/lib/server/invitations'

export const Route = createFileRoute('/login')({
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
    if (invitation?.status === 'pending' && !invitation.userExists) {
      throw redirect({
        to: '/signup',
        search: { redirect: deps.redirect },
      })
    }

    return invitation
  },
  component: LoginRoute,
})

function LoginRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const invitation = Route.useLoaderData()
  const invitationIsPending = invitation?.status === 'pending'
  const invitationStatusMessage = getInvitationStatusMessage(invitation)

  return (
    <LoginPage
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
 * Keeps invitation links out of the wrong auth mode. Better Auth requires the
 * eventual accept call to run with an authenticated matching-email session; this
 * copy explains stale links while pending existing-user invites go straight to a
 * locked-email sign-in form.
 */
function getInvitationStatusMessage(invitation: SignupInvitationPreview) {
  if (!invitation || invitation.status === 'pending') return undefined
  const target = invitation.organizationName
    ? ` for ${invitation.organizationName}`
    : ''

  switch (invitation.status) {
    case 'expired':
      return `This invitation${target} expired. Ask an admin for a fresh invite.`
    case 'accepted':
      return `This invitation${target} was already accepted. Sign in with the invited account.`
    case 'rejected':
    case 'canceled':
      return `This invitation${target} is no longer available. Ask an admin for a new invite.`
  }
}
