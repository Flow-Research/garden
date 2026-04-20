import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
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
      PUT: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const body = (await request.json().catch(() => null)) as {
          content?: unknown
        } | null
        if (typeof body?.content !== 'string' || !body.content.trim()) {
          return badRequest('Comment content is required')
        }

        const db = getDb(appEnv)
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
          .set({ body: body.content.trim() })
          .where(eq(schema.issueComment.id, params.id))
          .returning()

        if (!updatedComment) return notFound('Comment not found')
        return Response.json(toComment(updatedComment))
      },
      DELETE: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const db = getDb(appEnv)
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
