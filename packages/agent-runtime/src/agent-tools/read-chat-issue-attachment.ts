import { Buffer } from 'node:buffer'
import { Result } from 'better-result'
import { and, eq, inArray, or } from 'drizzle-orm'
import { tool } from 'ai'
import { getPooledDb } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import { readIssue } from '@garden/server/issues/server'
import { z } from 'zod'

const MAX_MODEL_ATTACHMENT_BYTES = 3.5 * 1024 * 1024

const readChatIssueAttachmentInputSchema = z
  .object({
    issue_id_or_identifier: z
      .string()
      .min(1)
      .describe('Issue identifier or UUID returned by read_issue.'),
    attachment_id: z
      .string()
      .uuid()
      .describe('Attachment id returned by read_issue for this issue.'),
  })
  .strict()

type AttachmentRow = typeof schema.issueAttachment.$inferSelect

type ReadChatIssueAttachmentContext = {
  databaseUrl: string
  threadId: string
  files: R2Bucket
}

type ScopedAttachment = {
  attachment: AttachmentRow
  issueId: string
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(1)} KiB`
  return `${(kib / 1024).toFixed(1)} MiB`
}

function attachmentKind(contentType: string) {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType === 'application/pdf') return 'file'
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType.endsWith('+json') ||
    contentType.endsWith('+xml')
  ) {
    return 'text'
  }
  return 'binary'
}

/**
 * Resolves the requested issue from this chat's workspace before looking up
 * the attachment. Regular chats previously had issue metadata but no way to
 * inspect its bytes; this scoped lookup follows the issue-run reader's R2 path
 * and includes comment attachments linked through their parent comment. The
 * scope mirrors `read-attachment.ts` and the issue/comment attachment joins in
 * `packages/server/src/issues/server.ts`.
 */
async function loadChatIssueAttachment(
  context: ReadChatIssueAttachmentContext,
  input: z.infer<typeof readChatIssueAttachmentInputSchema>,
): Promise<Result<ScopedAttachment, string>> {
  return Result.gen(async function* () {
    const db = getPooledDb(context.databaseUrl)
    const threadResult = Result.tryPromise({
      try: async () => {
        const [thread] = await db
          .select({
            workspaceId: schema.chatThread.workspaceId,
            ownerUserId: schema.chatThread.ownerUserId,
          })
          .from(schema.chatThread)
          .where(
            or(
              eq(schema.chatThread.id, context.threadId),
              eq(schema.chatThread.runtimeKey, context.threadId),
            ),
          )
          .limit(1)
        return thread ?? null
      },
      catch: (cause) =>
        `Could not load chat workspace: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    const thread = yield* Result.await(threadResult)
    if (!thread) return Result.err('Chat thread not found.')

    const issueResult = await readIssue({
      databaseUrl: context.databaseUrl,
      workspaceId: thread.workspaceId,
      viewerUserId: thread.ownerUserId,
      issueIdOrIdentifier: input.issue_id_or_identifier,
    })
    if (issueResult.isErr()) return Result.err(issueResult.error.message)

    const issueCommentsResult = Result.tryPromise({
      try: async () =>
        await db
          .select({ id: schema.issueComment.id })
          .from(schema.issueComment)
          .where(eq(schema.issueComment.issueId, issueResult.value.issue_id)),
      catch: (cause) =>
        `Could not load issue comments: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    const issueComments = yield* Result.await(issueCommentsResult)
    const issueCommentIds = issueComments.map((comment) => comment.id)
    const issueAttachmentScope =
      issueCommentIds.length > 0
        ? (or(
            eq(schema.issueAttachment.issueId, issueResult.value.issue_id),
            inArray(schema.issueAttachment.commentId, issueCommentIds),
          ) ?? eq(schema.issueAttachment.issueId, issueResult.value.issue_id))
        : eq(schema.issueAttachment.issueId, issueResult.value.issue_id)

    const attachmentResult = Result.tryPromise({
      try: async () => {
        const [attachment] = await db
          .select()
          .from(schema.issueAttachment)
          .where(
            and(
              eq(schema.issueAttachment.id, input.attachment_id),
              eq(schema.issueAttachment.workspaceId, thread.workspaceId),
              issueAttachmentScope,
            ),
          )
          .limit(1)
        return attachment ?? null
      },
      catch: (cause) =>
        `Could not load issue attachment: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    const attachment = yield* Result.await(attachmentResult)
    if (!attachment) {
      return Result.err('Attachment not found on the requested issue.')
    }

    return Result.ok({ attachment, issueId: issueResult.value.issue_id })
  })
}

/**
 * Reads stored bytes after issue/workspace ownership has been established.
 * Missing R2 objects and storage failures remain recoverable tool errors. The
 * R2 access pattern follows `read-attachment.ts` in this package.
 */
async function loadAttachmentBytes(
  context: ReadChatIssueAttachmentContext,
  attachment: AttachmentRow,
): Promise<Result<Buffer, string>> {
  const objectResult = await Result.tryPromise({
    try: async () => await context.files.get(attachment.r2Key),
    catch: (cause) =>
      `Could not read attachment storage: ${cause instanceof Error ? cause.message : String(cause)}`,
  })
  if (objectResult.isErr()) return Result.err(objectResult.error)
  const object = objectResult.value
  if (!object) return Result.err('Attachment bytes not found.')

  return Result.tryPromise({
    try: async () => Buffer.from(await object.arrayBuffer()),
    catch: (cause) =>
      `Could not decode attachment bytes: ${cause instanceof Error ? cause.message : String(cause)}`,
  })
}

/**
 * Gives regular chat agents a workspace- and issue-scoped attachment reader.
 * Image/PDF bytes are attached only to model output, never durable tool output.
 * This brings regular chats in line with issue runs; private multimodal result
 * parts follow `documentReadModelOutput` in `chat-sub-agent-tools.ts`.
 */
export function createReadChatIssueAttachmentTool(
  context: ReadChatIssueAttachmentContext,
) {
  return tool({
    description:
      'Read an attachment on a Garden issue. First use read_issue, then provide its issue identifier and attachment id. Images and PDFs are passed privately to the model for inspection.',
    inputSchema: readChatIssueAttachmentInputSchema,
    execute: async (input) => {
      const scopedResult = await loadChatIssueAttachment(context, input)
      if (scopedResult.isErr()) return { error: scopedResult.error }

      const { attachment } = scopedResult.value
      const kind = attachmentKind(attachment.contentType)
      let content: string | undefined
      if (kind === 'text') {
        const bytesResult = await loadAttachmentBytes(context, attachment)
        if (bytesResult.isErr()) return { error: bytesResult.error }
        content = Buffer.from(bytesResult.value).toString('utf8')
      }

      return {
        attachment_id: attachment.id,
        issue_id: scopedResult.value.issueId,
        comment_id: attachment.commentId,
        filename: attachment.filename,
        media_type: attachment.contentType,
        size_bytes: attachment.sizeBytes,
        kind,
        ...(content === undefined ? {} : { content }),
        note:
          kind === 'image' || kind === 'file'
            ? `Read ${attachment.filename} (${attachment.contentType}, ${formatAttachmentSize(attachment.sizeBytes)}). File bytes are attached privately to the model result.`
            : `Read ${attachment.filename} (${attachment.contentType}, ${formatAttachmentSize(attachment.sizeBytes)}).`,
      }
    },
    toModelOutput: async ({ input, output }) => {
      if (!output || typeof output !== 'object') {
        return { type: 'json' as const, value: output as never }
      }
      const result = output as Record<string, unknown>
      if (typeof result.error === 'string') {
        return { type: 'error-text' as const, value: result.error }
      }
      if (typeof result.content === 'string') {
        return { type: 'text' as const, value: result.content }
      }
      if (result.kind !== 'image' && result.kind !== 'file') {
        return { type: 'json' as const, value: result as never }
      }

      const parsedInput = readChatIssueAttachmentInputSchema.safeParse(input)
      if (!parsedInput.success) {
        return {
          type: 'error-text' as const,
          value: 'Invalid attachment reference.',
        }
      }
      const scopedResult = await loadChatIssueAttachment(
        context,
        parsedInput.data,
      )
      if (scopedResult.isErr()) {
        return { type: 'error-text' as const, value: scopedResult.error }
      }
      const bytesResult = await loadAttachmentBytes(
        context,
        scopedResult.value.attachment,
      )
      if (bytesResult.isErr()) {
        return { type: 'error-text' as const, value: bytesResult.error }
      }
      if (bytesResult.value.byteLength > MAX_MODEL_ATTACHMENT_BYTES) {
        return {
          type: 'error-text' as const,
          value: `Attachment exceeds the ${formatAttachmentSize(MAX_MODEL_ATTACHMENT_BYTES)} inline model output limit.`,
        }
      }

      const attachment = scopedResult.value.attachment
      const data = Buffer.from(bytesResult.value).toString('base64')
      return {
        type: 'content' as const,
        value: [
          {
            type: 'text' as const,
            text:
              typeof result.note === 'string'
                ? result.note
                : `Read ${attachment.filename} (${attachment.contentType}).`,
          },
          result.kind === 'image'
            ? {
                type: 'image-data' as const,
                data,
                mediaType: attachment.contentType,
              }
            : {
                type: 'file-data' as const,
                data,
                mediaType: attachment.contentType,
                filename: attachment.filename,
              },
        ],
      }
    },
  })
}
