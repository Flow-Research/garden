import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { markInboxThreadRead } from '@/lib/server/inbox-dismissal'
import {
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox/$id/read')({
  server: {
    handlers: {
      POST: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) return unauthorized()
        await markInboxThreadRead({
          workspaceId,
          userId: session.user.id,
          itemKey: decodeURIComponent(params.id),
        })
        return Response.json({ ok: true })
      },
    },
  },
})
