import { Buffer } from 'node:buffer'
import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { tool } from 'ai'
import { z } from 'zod'
import * as schema from '@garden/db/schema'
import {
  dbError,
  getIssueRunDb,
  IssueRunToolError,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunToolContext,
} from './issue-run-tool-context'

const MAX_MODEL_ATTACHMENT_BYTES = 3.5 * 1024 * 1024

export const readAttachmentInputSchema = z
  .object({
    attachment_id: z
      .string()
      .uuid()
      .describe('Attachment id shown on an issue body/comment attachment.'),
  })
  .strict()

type AttachmentRow = typeof schema.issueAttachment.$inferSelect

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(1)} KiB`
  return `${(kib / 1024).toFixed(1)} MiB`
}

function isTextMediaType(mediaType: string) {
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType.endsWith('+json') ||
    mediaType.endsWith('+xml')
  )
}

function attachmentKind(mediaType: string) {
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf') return 'file'
  if (isTextMediaType(mediaType)) return 'text'
  return 'binary'
}

/**
 * Resolves only attachments owned by the active issue and workspace. The
 * composite scope prevents a model-supplied UUID from reading another issue's
 * object even when the caller can guess or recover that identifier.
 */
async function loadIssueAttachment(args: {
  context: IssueRunToolContext
  attachmentId: string
}) {
  return await Result.gen(async function* () {
    const run = yield* requireRunState(args.context)
    const db = getIssueRunDb(args.context.env.HYPERDRIVE.connectionString)
    const row = yield* Result.await(
      Result.tryPromise({
        try: async () => {
          const [attachment] = await db
            .select()
            .from(schema.issueAttachment)
            .where(
              and(
                eq(schema.issueAttachment.id, args.attachmentId),
                eq(schema.issueAttachment.workspaceId, run.workspaceId),
                eq(schema.issueAttachment.issueId, run.issueId),
              ),
            )
            .limit(1)
          return attachment ?? null
        },
        catch: (cause) => dbError('load issue attachment', cause),
      }),
    )

    if (!row) {
      return Result.err(
        new IssueRunToolError({
          code: 'not_found',
          message: 'Attachment not found on this issue.',
        }),
      )
    }

    return Result.ok(row)
  })
}

/**
 * Loads attachment bytes from Garden's FILES bucket only after the scoped DB
 * lookup succeeds. Missing objects remain a recoverable product error; R2 I/O
 * failures remain distinguishable from database failures.
 */
async function loadIssueAttachmentBytes(args: {
  context: IssueRunToolContext
  attachment: AttachmentRow
}) {
  return await Result.gen(async function* () {
    const object = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          await args.context.env.FILES.get(args.attachment.r2Key),
        catch: (cause) =>
          new IssueRunToolError({
            code: 'storage_failed',
            message: `Read issue attachment bytes failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      }),
    )
    if (!object) {
      return Result.err(
        new IssueRunToolError({
          code: 'not_found',
          message: 'Attachment bytes not found.',
        }),
      )
    }

    const buffer = yield* Result.await(
      Result.tryPromise({
        try: async () => Buffer.from(await object.arrayBuffer()),
        catch: (cause) =>
          new IssueRunToolError({
            code: 'storage_failed',
            message: `Decode issue attachment bytes failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      }),
    )
    return Result.ok(buffer)
  })
}

/**
 * Returns metadata to the transcript while keeping image/PDF bytes out of the
 * public tool result. Think receives those bytes later through toModelOutput.
 */
function attachmentMetadata(row: AttachmentRow, content?: string) {
  const kind = attachmentKind(row.contentType)
  return toolOkResult({
    attachment_id: row.id,
    issue_id: row.issueId,
    comment_id: row.commentId,
    filename: row.filename,
    media_type: row.contentType,
    size_bytes: row.sizeBytes,
    kind,
    model_readable: kind === 'image' || kind === 'file' || kind === 'text',
    ...(content !== undefined ? { content } : {}),
    note:
      kind === 'image'
        ? `Read ${row.filename} (${row.contentType}, ${formatSize(row.sizeBytes)}). Image bytes are attached privately to the model result.`
        : kind === 'file'
          ? `Read ${row.filename} (${row.contentType}, ${formatSize(row.sizeBytes)}). File bytes are attached privately to the model result.`
          : `Read ${row.filename} (${row.contentType}, ${formatSize(row.sizeBytes)}).`,
  })
}

/**
 * Converts successful image/PDF metadata into AI SDK private content parts.
 * Binary payloads are loaded lazily and bounded so stored bytes never leak into
 * the durable transcript or unexpectedly consume the model context window.
 */
async function issueAttachmentModelOutput(args: {
  context: IssueRunToolContext
  input: unknown
  output: unknown
}) {
  if (!args.output || typeof args.output !== 'object') {
    return { type: 'json' as const, value: args.output as never }
  }
  const output = args.output as Record<string, unknown>
  if (typeof output.error === 'string') {
    return { type: 'error-text' as const, value: output.error }
  }
  if (typeof output.content === 'string') {
    return { type: 'text' as const, value: output.content }
  }
  if (output.kind !== 'image' && output.kind !== 'file') {
    return { type: 'json' as const, value: output as never }
  }
  if (!args.input || typeof args.input !== 'object') {
    return { type: 'json' as const, value: output as never }
  }
  const attachmentId = (args.input as { attachment_id?: unknown }).attachment_id
  if (typeof attachmentId !== 'string') {
    return { type: 'json' as const, value: output as never }
  }

  const attachmentResult = await loadIssueAttachment({
    context: args.context,
    attachmentId,
  })
  if (attachmentResult.isErr()) {
    return {
      type: 'error-text' as const,
      value: attachmentResult.error.message,
    }
  }
  const bytesResult = await loadIssueAttachmentBytes({
    context: args.context,
    attachment: attachmentResult.value,
  })
  if (bytesResult.isErr()) {
    return { type: 'error-text' as const, value: bytesResult.error.message }
  }
  if (bytesResult.value.byteLength > MAX_MODEL_ATTACHMENT_BYTES) {
    return {
      type: 'error-text' as const,
      value: `Read ${attachmentResult.value.filename}, but it exceeds the ${formatSize(MAX_MODEL_ATTACHMENT_BYTES)} inline model output limit.`,
    }
  }

  const data = bytesResult.value.toString('base64')
  const text =
    typeof output.note === 'string'
      ? output.note
      : `Read ${attachmentResult.value.filename} (${attachmentResult.value.contentType}, ${formatSize(bytesResult.value.byteLength)}).`
  return {
    type: 'content' as const,
    value: [
      { type: 'text' as const, text },
      output.kind === 'image'
        ? {
            type: 'image-data' as const,
            data,
            mediaType: attachmentResult.value.contentType,
          }
        : {
            type: 'file-data' as const,
            data,
            mediaType: attachmentResult.value.contentType,
            filename: attachmentResult.value.filename,
          },
    ],
  }
}

/**
 * Gives issue agents explicit, tenant-scoped access to uploaded evidence.
 * Text is returned directly; images and PDFs use lazy private model parts so
 * screenshot inspection has parity with Think's workspace read behavior.
 */
export function createReadAttachmentTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Read an attachment on the current issue. Use this after the issue body or comments mention an attachment id, especially for screenshots/images. Images and PDFs are lazily loaded into the model with private image-data/file-data parts.',
    inputSchema: readAttachmentInputSchema,
    execute: async ({ attachment_id }) => {
      const attachmentResult = await loadIssueAttachment({
        context,
        attachmentId: attachment_id,
      })
      if (attachmentResult.isErr())
        return toolErrorResult(attachmentResult.error)
      const attachment = attachmentResult.value

      if (attachmentKind(attachment.contentType) === 'text') {
        const bytesResult = await loadIssueAttachmentBytes({
          context,
          attachment,
        })
        if (bytesResult.isErr()) return toolErrorResult(bytesResult.error)
        return attachmentMetadata(
          attachment,
          bytesResult.value.toString('utf8'),
        )
      }

      return attachmentMetadata(attachment)
    },
    toModelOutput: async ({ input, output }) =>
      await issueAttachmentModelOutput({ context, input, output }),
  })
}
