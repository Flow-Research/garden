import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'

function toTimelineComment(
  row: typeof schema.issueComment.$inferSelect,
) {
  const createdAt = (row.createdAt ?? new Date()).toISOString()

  return {
    type: 'comment' as const,
    id: row.id,
    actor_type: row.authorType === 'user' ? 'member' : row.authorType,
    actor_id: row.authorId,
    content: row.body,
    parent_id: null,
    comment_type: 'comment',
    reactions: [],
    attachments: [],
    created_at: createdAt,
    updated_at: createdAt,
  }
}

export const Route = createFileRoute('/api/issues/$id/timeline')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({
            id: schema.issue.id,
            workspaceId: schema.issue.workspaceId,
            createdBy: schema.issue.createdBy,
            createdAt: schema.issue.createdAt,
          })
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

        return Response.json([
          {
            type: 'activity',
            id: `created:${existingIssue.id}`,
            actor_type: 'member',
            actor_id: existingIssue.createdBy,
            action: 'created',
            details: {},
            created_at: (existingIssue.createdAt ?? new Date()).toISOString(),
          },
          ...comments.map(toTimelineComment),
        ])
      },
    },
  },
})
