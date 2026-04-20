import { createFileRoute } from '@tanstack/react-router'
import {
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/projects')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        return Response.json({ projects: [], total: 0 })
      },
    },
  },
})
