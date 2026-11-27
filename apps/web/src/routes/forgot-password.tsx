import { createFileRoute } from '@tanstack/react-router'
import { RequestPasswordResetPage } from '@/features/auth'
import { sanitizeRedirectTarget } from '@/lib/redirect'

export const Route = createFileRoute('/forgot-password')({
  validateSearch: (search) => ({
    email: typeof search.email === 'string' ? search.email : undefined,
    redirect:
      typeof search.redirect === 'string'
        ? sanitizeRedirectTarget(search.redirect)
        : undefined,
  }),
  component: ForgotPasswordRoute,
})

function ForgotPasswordRoute() {
  const { email, redirect } = Route.useSearch()
  return (
    <RequestPasswordResetPage initialEmail={email} redirectTarget={redirect} />
  )
}
