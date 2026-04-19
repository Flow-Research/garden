import { createFileRoute, redirect } from '@tanstack/react-router'
import { getRouteSession } from '@/lib/server/route-session'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await getRouteSession()

    throw redirect({
      to: session ? '/workspace' : '/login',
    })
  },
  component: IndexRoute,
})

function IndexRoute() {
  return null
}
