import { createFileRoute } from '@tanstack/react-router'
import { computeInboxItems } from '@/lib/server/inbox-compute'
import { requireWorkspaceContext } from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/inbox')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await requireWorkspaceContext(request, {
          missingWorkspaceResponse: () => Response.json([]),
        })
        if (context instanceof Response) return context
        const { session, workspaceId } = context

        const items = await computeInboxItems({
          workspaceId,
          userId: session.user.id,
        })
        return Response.json(items)
      },
    },
  },
})
