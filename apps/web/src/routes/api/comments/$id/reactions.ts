import { createFileRoute } from '@tanstack/react-router'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/comments/$id/reactions')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const body = (await request.json().catch(() => null)) as {
          emoji?: unknown
        } | null
        if (typeof body?.emoji !== 'string' || !body.emoji.trim()) {
          return badRequest('Emoji is required')
        }

        return Response.json({
          id: crypto.randomUUID(),
          comment_id: params.id,
          actor_type: 'member',
          actor_id: session.user.id,
          emoji: body.emoji.trim(),
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
