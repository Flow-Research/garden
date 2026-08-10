import { createFileRoute } from '@tanstack/react-router'
import { buildContentDisposition } from '@garden/agent-runtime'
import { requireAppRequestContext } from '@/lib/server/context'
import { readAuthorizedMailAttachment } from '@/lib/server/mail-content'

/** Serves an authenticated immutable attachment with repository-owned headers. */
export const Route = createFileRoute(
  '/api/mail/$conversationId/messages/$messageId/attachments/$attachmentId',
)({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const url = new URL(request.url)
        const workspaceId = url.searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json(
            { error: 'workspaceId is required.' },
            { status: 400 },
          )
        }
        const object = await readAuthorizedMailAttachment(
          requireAppRequestContext(context),
          {
            workspaceId,
            conversationId: params.conversationId,
            messageId: params.messageId,
            attachmentId: params.attachmentId,
          },
        )
        return new Response(new Uint8Array(object.content).buffer, {
          headers: {
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': buildContentDisposition(
              url.searchParams.has('download') ? 'attachment' : 'inline',
              object.fileName,
            ),
            'Content-Type': object.contentType,
            'X-Content-Type-Options': 'nosniff',
          },
        })
      },
    },
  },
})
