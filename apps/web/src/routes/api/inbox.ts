import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { computeInboxItems } from '@/lib/server/inbox-compute'
import { requireWorkspaceContext } from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext, {
          missingWorkspaceResponse: () => Response.json([]),
        })
        if (workspaceContext instanceof Response) return workspaceContext
        const { session, workspaceId } = workspaceContext

        const items = await computeInboxItems({
          db: await appContext.db(),
          workspaceId,
          userId: session.user.id,
        })
        return Response.json(items)
      },
    },
  },
})
