import { Result, type Result as ResultValue } from 'better-result'
import {
  IssueServiceError,
  toIssueAttachment,
  toIssueComment,
} from '@garden/server/issues/server'
import type { Comment } from '@garden/core/types/comment'
import type { Db } from '@/lib/server/db'
import { listIssueCommentRowsWithAttachments } from '@/lib/server/queries/issues'

/**
 * Lists issue comments with attachments for `GET /api/issues/$id/comments`.
 */
export async function listIssueComments(
  db: Db,
  issueId: string,
): Promise<ResultValue<Comment[], IssueServiceError>> {
  return await Result.tryPromise({
    try: async () => {
      const { comments, attachments } =
        await listIssueCommentRowsWithAttachments(db, issueId)
      const mappedAttachments = attachments.map(toIssueAttachment)
      const attachmentsByCommentId = new Map(
        comments.map((comment) => [
          comment.id,
          mappedAttachments.filter(
            (attachment) => attachment.comment_id === comment.id,
          ),
        ]),
      )
      return comments.map((comment) =>
        toIssueComment(comment, attachmentsByCommentId.get(comment.id) ?? []),
      )
    },
    catch: (cause) =>
      new IssueServiceError({
        code: 'db_error',
        message: 'list issue comments failed',
        cause,
      }),
  })
}
