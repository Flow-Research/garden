import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { archiveInboxItem } from '@/lib/server/inbox-dismissal'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox/$id/archive')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return unauthorized()
        await archiveInboxItem({
          workspaceId,
          userId: session.user.id,
          itemKey: decodeURIComponent(params.id),
        })
        return Response.json({ ok: true })
      },
    },
  },
})
