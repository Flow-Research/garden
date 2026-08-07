import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { computeInboxUnreadCount } from '@/lib/server/inbox-compute'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox/unread-count')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json({ count: 0 })

        const count = await computeInboxUnreadCount({
          workspaceId,
          userId: session.user.id,
        })
        return Response.json({ count })
      },
    },
  },
})
