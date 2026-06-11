import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { listChatThreadDocumentVersions } from '@/lib/server/chat-agents'
import { getChatDocumentAccess } from '@/lib/server/document-access'

export const Route = createFileRoute('/api/documents/$id/versions')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const routeParams = params as { id: string }
        const access = await getChatDocumentAccess(appContext, routeParams.id)
        if (access instanceof Response) return access

        const result = await listChatThreadDocumentVersions({
          documentId: routeParams.id,
          hostName: access.row.hostName,
          threadId: access.row.threadId,
        })
        return Response.json(result, { status: result?.ok ? 200 : 404 })
      },
    },
  },
})
