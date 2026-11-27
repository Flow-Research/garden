import { createFileRoute } from '@tanstack/react-router'
import { ResetPasswordPage } from '@/features/auth'
import { sanitizeRedirectTarget } from '@/lib/redirect'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    redirect:
      typeof search.redirect === 'string'
        ? sanitizeRedirectTarget(search.redirect)
        : undefined,
  }),
  component: ResetPasswordRoute,
})

function ResetPasswordRoute() {
  const { token, error, redirect } = Route.useSearch()
  return (
    <ResetPasswordPage
      token={token}
      invalidToken={Boolean(error)}
      redirectTarget={redirect}
    />
  )
}
