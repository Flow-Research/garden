import { Buffer } from 'node:buffer'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { readChatThreadDocumentVersionBytes } from '@/lib/server/chat-agents'
import { getChatDocumentAccess } from '@/lib/server/document-access'
import { storedObjectHeaders } from '@/lib/server/stored-object-headers'

export const Route = createFileRoute('/api/documents/$id/display')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const routeParams = params as { id: string }
        const access = await getChatDocumentAccess(appContext, routeParams.id)
        if (access instanceof Response) return access

        const url = new URL(request.url)
        const bytesResult = (await readChatThreadDocumentVersionBytes({
          documentId: routeParams.id,
          hostName: access.row.hostName,
          preferPdf: true,
          threadId: access.row.threadId,
          versionId: url.searchParams.get('version_id'),
        })) as
          | {
              base64: string
              filename?: string | null
              media_type?: string | null
              ok: true
            }
          | { error?: string; ok: false }
        if (!bytesResult?.ok) {
          return Response.json(
            { error: bytesResult?.error ?? 'Document display bytes not found' },
            { status: 404 },
          )
        }

        return new Response(Buffer.from(bytesResult.base64, 'base64'), {
          headers: storedObjectHeaders({
            contentType: bytesResult.media_type,
            filename: bytesResult.filename ?? access.row.filename,
            download: false,
          }),
        })
      },
    },
  },
})
