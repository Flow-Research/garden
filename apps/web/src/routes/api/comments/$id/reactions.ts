import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  reactionBodySchema,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/comments/$id/reactions')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const bodyResult = await parseJsonBody(
          request,
          reactionBodySchema,
          'Emoji is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        return Response.json({
          id: crypto.randomUUID(),
          comment_id: params.id,
          actor_type: 'member',
          actor_id: session.user.id,
          emoji: body.emoji,
          created_at: new Date().toISOString(),
        })
      },
      DELETE: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        return new Response(null, { status: 204 })
      },
    },
  },
})
