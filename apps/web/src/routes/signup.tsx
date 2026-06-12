import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getRouteSession } from '@/lib/server/route-session'
import {
  getSignupInvitationPreview,
  invitationIdFromRedirect,
} from '@/lib/server/invitations'

export const Route = createFileRoute('/signup')({
  staleTime: Number.POSITIVE_INFINITY,
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

    return getSignupInvitationPreview({ data: { invitationId } })
  },
  component: SignUpRoute,
})

function SignUpRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const invitation = Route.useLoaderData()
  const invitationIsPending = invitation?.status === 'pending'

  return (
    <LoginPage
      initialMode="signup"
      initialEmail={invitationIsPending ? invitation.email : undefined}
      lockedEmail={invitationIsPending}
      invitationWorkspaceName={
        invitationIsPending ? invitation.organizationName : undefined
      }
      onSuccess={() =>
        void navigate({ href: search.redirect ?? '/workspace', replace: true })
      }
    />
  )
}
