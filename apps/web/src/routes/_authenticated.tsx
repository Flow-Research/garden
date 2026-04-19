import { createFileRoute, redirect } from '@tanstack/react-router'
import { sanitizeRedirectTarget } from '@/lib/redirect'
import { getRouteSession } from '@/lib/server/route-session'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const session = await getRouteSession()
    if (session) return

    throw redirect({
      to: '/login',
      search: {
        redirect: sanitizeRedirectTarget(location.href, '/workspace'),
      },
    })
  },
})
