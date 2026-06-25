import { asc, eq, inArray } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { toIssueAttachment } from '@garden/server/issues/server'
import type { Attachment } from '@garden/core/types'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'

function toTimelineComment(
  row: typeof schema.issueComment.$inferSelect,
  attachments: Attachment[] = [],
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
    attachments,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function toTimelineRunEvent(row: {
  event: typeof schema.issueRunEvent.$inferSelect
  agentId: string
}) {
  return {
    type: 'activity' as const,
    id: row.event.id,
    actor_type: 'agent',
    actor_id: row.agentId,
    action: row.event.eventType,
    details:
      row.event.payload &&
      typeof row.event.payload === 'object' &&
      !Array.isArray(row.event.payload)
        ? (row.event.payload as Record<string, unknown>)
        : {},
    created_at: (row.event.createdAt ?? new Date()).toISOString(),
    event: {
      id: row.event.id,
      workspace_id: row.event.workspaceId,
      issue_id: row.event.issueId,
      run_id: row.event.runId,
      seq: row.event.seq,
      event_type: row.event.eventType,
      stream: row.event.stream,
      level: row.event.level,
      message: row.event.message ?? null,
      payload:
        row.event.payload &&
        typeof row.event.payload === 'object' &&
        !Array.isArray(row.event.payload)
          ? (row.event.payload as Record<string, unknown>)
          : null,
      created_at: (row.event.createdAt ?? new Date()).toISOString(),
    },
  }
}

export const Route = createFileRoute('/api/issues/$id/timeline')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
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

        const commentIds = comments.map((comment) => comment.id)
        const attachments = commentIds.length
          ? (
              await db
                .select()
                .from(schema.issueAttachment)
                .where(inArray(schema.issueAttachment.commentId, commentIds))
                .orderBy(asc(schema.issueAttachment.createdAt))
            ).map(toIssueAttachment)
          : []
        const attachmentsByCommentId = new Map(
          commentIds.map((commentId) => [
            commentId,
            attachments.filter(
              (attachment) => attachment.comment_id === commentId,
            ),
          ]),
        )

        const runEvents = await db
          .select({
            event: schema.issueRunEvent,
            agentId: schema.issueRun.agentId,
          })
          .from(schema.issueRunEvent)
          .innerJoin(
            schema.issueRun,
            eq(schema.issueRun.id, schema.issueRunEvent.runId),
          )
          .where(eq(schema.issueRunEvent.issueId, params.id))

        const entries = [
          {
            type: 'activity',
            id: `created:${existingIssue.id}`,
            actor_type: 'member',
            actor_id: existingIssue.createdBy,
            action: 'created',
            details: {},
            created_at: (existingIssue.createdAt ?? new Date()).toISOString(),
          },
          ...comments.map((comment) =>
            toTimelineComment(
              comment,
              attachmentsByCommentId.get(comment.id) ?? [],
            ),
          ),
          ...runEvents.map(toTimelineRunEvent),
        ].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )

        return Response.json(entries)
      },
    },
  },
})
