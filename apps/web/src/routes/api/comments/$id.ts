import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { commentBodySchema, parseJsonBody } from '@/lib/server/validation/issues'
import {
  badRequest,
  notFound,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

function toComment(row: typeof schema.issueComment.$inferSelect) {
  const createdAt = (row.createdAt ?? new Date()).toISOString()

  return {
    id: row.id,
    issue_id: row.issueId,
    author_type: row.authorType === 'user' ? 'member' : row.authorType,
    author_id: row.authorId,
    content: row.body,
    type: 'comment',
    parent_id: null,
    reactions: [],
    attachments: [],
    created_at: createdAt,
    updated_at: new Date().toISOString(),
  }
}

export const Route = createFileRoute('/api/comments/$id')({
  server: {
    handlers: {
      PUT: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const bodyResult = await parseJsonBody(
          request,
          commentBodySchema,
          'Comment content is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const db = await appContext.db()
        const [existingComment] = await db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.id, params.id))
        if (!existingComment) return notFound('Comment not found')

        if (
          existingComment.authorType === 'user' &&
          existingComment.authorId !== session.user.id
        ) {
          return Response.json({ error: 'Comment access denied' }, { status: 403 })
        }

        const [updatedComment] = await db
          .update(schema.issueComment)
          .set({ body: body.content })
          .where(eq(schema.issueComment.id, params.id))
          .returning()

        if (!updatedComment) return notFound('Comment not found')
        return Response.json(toComment(updatedComment))
      },
      DELETE: async ({ context, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const db = await appContext.db()
        const [existingComment] = await db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.id, params.id))
        if (!existingComment) return notFound('Comment not found')

        if (
          existingComment.authorType === 'user' &&
          existingComment.authorId !== session.user.id
        ) {
          return Response.json({ error: 'Comment access denied' }, { status: 403 })
        }

        await db.delete(schema.issueComment).where(eq(schema.issueComment.id, params.id))
        return new Response(null, { status: 204 })
      },
    },
  },
})
