import { createFileRoute } from '@tanstack/react-router'
import { listChatThreadDocumentVersions } from '@/lib/server/chat-agents'
import { getChatDocumentAccess } from '@/lib/server/document-access'

export const Route = createFileRoute('/api/documents/$id/versions')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const routeParams = params as { id: string }
        const access = await getChatDocumentAccess(request, routeParams.id)
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
