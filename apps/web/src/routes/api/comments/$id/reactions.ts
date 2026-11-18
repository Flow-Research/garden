import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  reactionBodySchema,
} from '@/lib/server/validation/issues'
import { badRequest, notFound } from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { getCommentIssueId } from '@/lib/server/queries/issues'

async function loadCommentIssueId(
  appContext: ReturnType<typeof requireAppRequestContext>,
  commentId: string,
) {
  const db = await appContext.db()
  return await getCommentIssueId(db, commentId)
}

export const Route = createFileRoute('/api/comments/$id/reactions')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const bodyResult = await parseJsonBody(
          request,
          reactionBodySchema,
          'Emoji is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const issueId = await loadCommentIssueId(appContext, params.id)
        if (!issueId) return notFound('Comment not found')
        const access = await requireIssueAccess(appContext, issueId)
        if (access instanceof Response) return access

        return Response.json({
          id: crypto.randomUUID(),
          comment_id: params.id,
          actor_type: 'member',
          actor_id: access.session.user.id,
          emoji: body.emoji,
          created_at: new Date().toISOString(),
        })
      },
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const issueId = await loadCommentIssueId(appContext, params.id)
        if (!issueId) return notFound('Comment not found')
        const access = await requireIssueAccess(appContext, issueId)
        if (access instanceof Response) return access
        return new Response(null, { status: 204 })
      },
    },
  },
})
