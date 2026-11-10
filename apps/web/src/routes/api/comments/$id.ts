import { eq } from 'drizzle-orm'
import {
  upsertIssueMentionInbox,
  explicitMemberMentionIds,
} from '@garden/db/inbox'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { issueCommentMentionsSchema } from '@garden/db/validation'
import {
  commentBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/issues'
import { badRequest, notFound } from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { publishWorkspaceEvent } from '@/lib/server/realtime'

function toComment(row: typeof schema.issueComment.$inferSelect) {
  const createdAt = (row.createdAt ?? new Date()).toISOString()
  const authorType =
    row.authorType === 'user'
      ? 'member'
      : row.authorType === 'connector'
        ? 'connector'
        : row.authorType

  return {
    id: row.id,
    issue_id: row.issueId,
    author_type: authorType,
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

        const access = await requireIssueAccess(
          appContext,
          existingComment.issueId,
        )
        if (access instanceof Response) return access

        if (existingComment.authorId !== access.session.user.id) {
          return Response.json(
            { error: 'Comment access denied' },
            { status: 403 },
          )
        }

        /**
         * Refresh member ids on edit without clearing existing agent metadata.
         * Previously edits left member mentions stale. Agent wake behavior
         * remains owned by the comment service, outside this email path.
         */
        const previousMentions = issueCommentMentionsSchema.safeParse(
          existingComment.mentions,
        )
        const [updatedComment] = await db
          .update(schema.issueComment)
          .set({
            body: body.content,
            mentions: {
              users: explicitMemberMentionIds(body.content),
              agents: previousMentions.success
                ? previousMentions.data.agents
                : [],
            },
          })
          .where(eq(schema.issueComment.id, params.id))
          .returning()

        if (!updatedComment) return notFound('Comment not found')
        await upsertIssueMentionInbox({
          db,
          workspaceId: access.issue.workspaceId,
          issueId: access.issue.id,
          content: updatedComment.body,
          commentId: updatedComment.id,
          actorType: 'member',
          actorId: access.session.user.id,
        })
        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, access.issue.workspaceId, {
            type: 'comment:updated',
            payload: {
              issue_id: access.issue.id,
              comment_id: updatedComment.id,
              team_id: access.issue.teamId,
            },
          }),
        )
        return Response.json(toComment(updatedComment))
      },
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)

        const db = await appContext.db()
        const [existingComment] = await db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.id, params.id))
        if (!existingComment) return notFound('Comment not found')

        const access = await requireIssueAccess(
          appContext,
          existingComment.issueId,
        )
        if (access instanceof Response) return access

        if (existingComment.authorId !== access.session.user.id) {
          return Response.json(
            { error: 'Comment access denied' },
            { status: 403 },
          )
        }

        await db
          .delete(schema.issueComment)
          .where(eq(schema.issueComment.id, params.id))
        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, access.issue.workspaceId, {
            type: 'comment:deleted',
            payload: {
              issue_id: access.issue.id,
              comment_id: existingComment.id,
              team_id: access.issue.teamId,
            },
          }),
        )
        return new Response(null, { status: 204 })
      },
    },
  },
})
