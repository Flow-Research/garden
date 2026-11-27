import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getRouteSession } from '@/lib/server/route-session'
import { getAuthProviderAvailability } from '@/lib/server/auth-providers'
import {
  invitationIdFromRedirect,
  type SignupInvitationPreview,
} from '@/lib/invitation-flow'
import { getSignupInvitationPreview } from '@/lib/server/invitations'
import { oauthErrorMessage } from '@/lib/auth/oauth-error'

export const Route = createFileRoute('/signup')({
  validateSearch: (search) => ({
    ...(typeof search.error === 'string' ? { error: search.error } : {}),
    redirect:
      typeof search.redirect === 'string'
        ? sanitizeRedirectTarget(search.redirect)
        : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const session = await getRouteSession()
    if (!session) return

    throw redirect({
      href: search.redirect ?? '/home',
    })
  },
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ deps }) => {
    const invitationId = invitationIdFromRedirect(deps.redirect)
    const [authProviders, invitation] = await Promise.all([
      getAuthProviderAvailability(),
      invitationId
        ? getSignupInvitationPreview({ data: { invitationId } })
        : Promise.resolve(null),
    ])
    if (invitation?.status === 'pending' && invitation.userExists) {
      throw redirect({
        to: '/login',
        search: { redirect: deps.redirect },
      })
    }

    return { authProviders, invitation }
  },
  component: SignUpRoute,
})

function SignUpRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const { authProviders, invitation } = Route.useLoaderData()
  const invitationIsPending = invitation?.status === 'pending'
  const invitationStatusMessage = getInvitationStatusMessage(invitation)

  return (
    <LoginPage
      googleAuthEnabled={authProviders.google}
      initialError={oauthErrorMessage(search.error)}
      initialMode="signup"
      initialEmail={invitationIsPending ? invitation.email : undefined}
      lockedEmail={invitationIsPending}
      invitationStatusMessage={invitationStatusMessage}
      invitationWorkspaceName={
        invitationIsPending ? invitation.organizationName : undefined
      }
      redirectTarget={search.redirect}
      onSuccess={() =>
        void navigate({ href: search.redirect ?? '/home', replace: true })
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
