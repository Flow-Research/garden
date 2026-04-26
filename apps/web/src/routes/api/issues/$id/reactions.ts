import { createFileRoute } from '@tanstack/react-router'
import { parseJsonBody, reactionBodySchema } from '@/lib/server/api-validation'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/$id/reactions')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request)
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
          issue_id: params.id,
          actor_type: 'member',
          actor_id: session.user.id,
          emoji: body.emoji,
          created_at: new Date().toISOString(),
        })
      },
      DELETE: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        return new Response(null, { status: 204 })
      },
    },
  },
})
