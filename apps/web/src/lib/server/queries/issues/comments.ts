import { asc, eq, inArray } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Loads all comments for an issue plus their attachments, grouped for DTO
 * mapping in the comments/timeline services.
 */
export async function listIssueCommentRowsWithAttachments(
  db: Db,
  issueId: string,
) {
  const comments = await db
    .select()
    .from(schema.issueComment)
    .where(eq(schema.issueComment.issueId, issueId))
  const commentIds = comments.map((comment) => comment.id)
  const attachments = commentIds.length
    ? await db
        .select()
        .from(schema.issueAttachment)
        .where(inArray(schema.issueAttachment.commentId, commentIds))
        .orderBy(asc(schema.issueAttachment.createdAt))
    : []
  return { comments, attachments }
}

/** Loads one issue comment by id, or null. */
export async function getIssueCommentById(db: Db, commentId: string) {
  const [comment] = await db
    .select()
    .from(schema.issueComment)
    .where(eq(schema.issueComment.id, commentId))
  return comment ?? null
}

/** Returns the issue id for a comment, or null when missing. */
export async function getCommentIssueId(db: Db, commentId: string) {
  const [comment] = await db
    .select({ issueId: schema.issueComment.issueId })
    .from(schema.issueComment)
    .where(eq(schema.issueComment.id, commentId))
  return comment?.issueId ?? null
}

/** Updates a comment body and returns the row, or null when missing. */
export async function updateIssueCommentBody(
  db: Db,
  input: { commentId: string; body: string },
) {
  const [updated] = await db
    .update(schema.issueComment)
    .set({ body: input.body })
    .where(eq(schema.issueComment.id, input.commentId))
    .returning()
  return updated ?? null
}

/** Deletes a comment by id. */
export async function deleteIssueCommentById(db: Db, commentId: string) {
  await db
    .delete(schema.issueComment)
    .where(eq(schema.issueComment.id, commentId))
}
