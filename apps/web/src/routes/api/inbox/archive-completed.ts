import { createFileRoute } from '@tanstack/react-router'
import { archiveAllVisible } from '@/lib/server/inbox-dismissal'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox/archive-completed')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json({ count: 0 })
        const count = await archiveAllVisible({
          workspaceId,
          userId: session.user.id,
          predicate: (item) =>
            item.issueStatus === 'done' || item.issueStatus === 'cancelled',
        })
        return Response.json({ count })
      },
    },
  },
})
