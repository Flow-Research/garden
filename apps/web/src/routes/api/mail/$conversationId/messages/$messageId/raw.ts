import { createFileRoute } from '@tanstack/react-router'
import { Result } from 'better-result'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  mailContentErrorResponse,
  readAuthorizedRawMessage,
} from '@/lib/server/mail-content'

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
        const result = await Result.tryPromise({
          try: () =>
            readAuthorizedRawMessage(requireAppRequestContext(context), {
              workspaceId,
              conversationId: params.conversationId,
              messageId: params.messageId,
            }),
          catch: (error) => error,
        })
        return result.match({
          ok: (object) =>
            new Response(new Uint8Array(object.content).buffer, {
              headers: {
                'Cache-Control': 'private, max-age=3600',
                'Content-Disposition': 'inline',
                'Content-Type': object.contentType,
                'X-Content-Type-Options': 'nosniff',
              },
            }),
          err: (error) => {
            const response = mailContentErrorResponse(error)
            if (response) return response
            throw error
          },
        })
      },
    },
  },
})
