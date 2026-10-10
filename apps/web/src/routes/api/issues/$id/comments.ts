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
} from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'

export const Route = createFileRoute('/api/issues/$id/comments')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const db = access.db

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
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const existingIssue = access.issue

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
