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

export const Route = createFileRoute('/login')({
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
    if (invitation?.status === 'pending' && !invitation.userExists) {
      throw redirect({
        to: '/signup',
        search: { redirect: deps.redirect },
      })
    }

    return { authProviders, invitation }
  },
  component: LoginRoute,
})

function LoginRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const { authProviders, invitation } = Route.useLoaderData()
  const invitationIsPending = invitation?.status === 'pending'
  const invitationStatusMessage = getInvitationStatusMessage(invitation)

  return (
    <LoginPage
      googleAuthEnabled={authProviders.google}
      initialError={oauthErrorMessage(search.error)}
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
