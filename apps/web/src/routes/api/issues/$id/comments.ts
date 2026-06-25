import { asc, eq, inArray } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  postIssueComment,
  toIssueAttachment,
  toIssueComment,
} from '@garden/server/issues/server'
import { archiveInboxItemsByKey } from '@garden/db/inbox'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  commentBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/$id/comments')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
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

        return Response.json(
          comments.map((comment) =>
            toIssueComment(
              comment,
              attachmentsByCommentId.get(comment.id) ?? [],
            ),
          ),
        )
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const bodyResult = await parseJsonBody(
          request,
          commentBodySchema,
          'Comment content is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const db = await appContext.db()
        const [existingIssue] = await db
          .select({
            id: schema.issue.id,
            workspaceId: schema.issue.workspaceId,
            activeRunId: schema.issue.activeRunId,
          })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const commentResult = await postIssueComment({
          databaseUrl: appEnv.HYPERDRIVE.connectionString,
          workspaceId: existingIssue.workspaceId,
          issueIdOrIdentifier: params.id,
          authorUserId: access.session.user.id,
          body: body.content,
          parentId: body.parent_id ?? null,
          attachmentIds: body.attachment_ids,
          issueRunEnv: appEnv,
        })
        if (commentResult.isErr())
          return badRequest(commentResult.error.message)
        if (existingIssue.activeRunId) {
          await archiveInboxItemsByKey({
            db,
            workspaceId: existingIssue.workspaceId,
            itemKeys: [`waiting_for_input:${existingIssue.activeRunId}`],
          })
        }

        return Response.json(commentResult.value.comment, { status: 201 })
      },
    },
  },
})
