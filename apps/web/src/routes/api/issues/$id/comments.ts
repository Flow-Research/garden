import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { commentBodySchema, parseJsonBody } from '@/lib/server/api-validation'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
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
    updated_at: createdAt,
  }
}

export const Route = createFileRoute('/api/issues/$id/comments')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const comments = await db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.issueId, params.id))

        return Response.json(comments.map(toComment))
      },
      POST: async ({ request, params }) => {
        const bodyResult = await parseJsonBody(
          request,
          commentBodySchema,
          'Comment content is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const [comment] = await db
          .insert(schema.issueComment)
          .values({
            id: crypto.randomUUID(),
            issueId: params.id,
            authorType: 'user',
            authorId: access.session.user.id,
            body: body.content,
          })
          .returning()

        return Response.json(toComment(comment), { status: 201 })
      },
    },
  },
})
