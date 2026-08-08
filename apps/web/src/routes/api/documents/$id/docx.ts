import { Buffer } from 'node:buffer'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { buildContentDisposition } from '@garden/agent-runtime'
import { readChatThreadDocumentVersionBytes } from '@/lib/server/chat-agents'
import { getChatDocumentAccess } from '@/lib/server/document-access'

/** Serves immutable source bytes; canonical editor state is a separate artifact. */
export const Route = createFileRoute('/api/documents/$id/docx')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const routeParams = params as { id: string }
        const access = await getChatDocumentAccess(appContext, routeParams.id)
        if (access instanceof Response) return access

        const url = new URL(request.url)
        const bytesResult = (await readChatThreadDocumentVersionBytes({
          threadId: access.row.threadId,
          hostName: access.row.hostName,
          documentId: routeParams.id,
          versionId: url.searchParams.get('version_id'),
        })) as
          | {
              ok: true
              base64: string
              file_type?: string | null
              filename?: string | null
              media_type?: string | null
              version_id?: string | null
            }
          | { ok: false; error?: string }
        if (!bytesResult?.ok) {
          return Response.json(
            { error: bytesResult?.error ?? 'Document bytes not found' },
            { status: 404 },
          )
        }
        const bytes = Buffer.from(bytesResult.base64, 'base64')

        const filename =
          url.searchParams.get('filename') ??
          bytesResult.filename ??
          access.row.filename
        return new Response(toArrayBuffer(bytes), {
          headers: {
            'Content-Type':
              bytesResult.media_type ??
              contentTypeForFileType(access.row.fileType),
            'Content-Disposition': buildContentDisposition(
              'attachment',
              filename,
            ),
            'X-Garden-Document-Representation': 'original-source',
          },
        })
      },
    },
  },
})

function toArrayBuffer(bytes: Buffer) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function contentTypeForFileType(fileType: string) {
  switch (fileType) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'doc':
      return 'application/msword'
    case 'pdf':
      return 'application/pdf'
    case 'txt':
    case 'md':
      return 'text/plain; charset=utf-8'
    case 'json':
      return 'application/json'
    case 'csv':
      return 'text/csv'
    default:
      return 'application/octet-stream'
  }
}
