import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireSession, unauthorized } from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/projects')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        return Response.json({ projects: [], total: 0 })
      },
    },
  },
})
