import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  reactionBodySchema,
} from '@/lib/server/validation/issues'
import { badRequest } from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'

export const Route = createFileRoute('/api/issues/$id/reactions')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access

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
          actor_id: access.session.user.id,
          emoji: body.emoji,
          created_at: new Date().toISOString(),
        })
      },
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        return new Response(null, { status: 204 })
      },
    },
  },
})
