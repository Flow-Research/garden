import { createFileRoute } from '@tanstack/react-router'
import { dismissInboxItem } from '@/lib/server/inbox-dismissal'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox/$id/read')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return unauthorized()
        await dismissInboxItem({
          workspaceId,
          userId: session.user.id,
          itemKey: decodeURIComponent(params.id),
        })
        return Response.json({ ok: true })
      },
    },
  },
})
