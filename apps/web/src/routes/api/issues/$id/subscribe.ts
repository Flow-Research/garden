import { createFileRoute } from '@tanstack/react-router'
import {
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/$id/subscribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        return new Response(null, { status: 204 })
      },
    },
  },
})
