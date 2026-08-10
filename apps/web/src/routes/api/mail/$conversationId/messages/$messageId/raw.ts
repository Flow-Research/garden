import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { readAuthorizedRawMessage } from '@/lib/server/mail-content'

/** Serves authenticated RFC 822 source without exposing its object-store key. */
export const Route = createFileRoute(
  '/api/mail/$conversationId/messages/$messageId/raw',
)({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const workspaceId = new URL(request.url).searchParams.get('workspaceId')
        if (!workspaceId) {
          return Response.json(
            { error: 'workspaceId is required.' },
            { status: 400 },
          )
        }
        const object = await readAuthorizedRawMessage(
          requireAppRequestContext(context),
          {
            workspaceId,
            conversationId: params.conversationId,
            messageId: params.messageId,
          },
        )
        return new Response(new Uint8Array(object.content).buffer, {
          headers: {
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': 'inline',
            'Content-Type': object.contentType,
            'X-Content-Type-Options': 'nosniff',
          },
        })
      },
    },
  },
})
