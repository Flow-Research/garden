import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getRouteSession } from '@/lib/server/route-session'

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
  component: LoginRoute,
})

function LoginRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  return (
    <LoginPage
      onSuccess={() =>
        void navigate({ href: search.redirect ?? '/workspace', replace: true })
      }
    />
  )
}
