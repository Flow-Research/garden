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

/**
 * Chat attachments and issue-run image/PDF parts use this model payload cap.
 * Issue-run text keeps its earlier unlimited behavior.
 */
export const MAX_MODEL_ATTACHMENT_BYTES = 3.5 * 1024 * 1024

export const readAttachmentInputSchema = z
  .object({
    attachment_id: z
      .string()
      .uuid()
      .describe('Attachment id shown on an issue body/comment attachment.'),
  })
  .strict()

export type AttachmentRow = typeof schema.issueAttachment.$inferSelect

/**
 * File-store surface the attachment readers need. `R2Bucket` satisfies it
 * structurally, so callers pass `env.FILES` unchanged and tests can supply bytes
 * without standing up a whole bucket.
 */
export type AttachmentFileStore = {
  get: (
    key: string,
  ) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>
}

export function formatAttachmentSize(bytes: number) {
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

/**
 * Maps a stored media type onto the four transcript kinds. Shared so a new
 * model-readable file type only has to be taught here.
 */
export function attachmentKind(mediaType: string) {
  if (
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)
  ) {
    return 'image'
  }
  if (mediaType.startsWith('image/')) return 'binary'
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
 * Loads attachment bytes from Garden's FILES bucket only after the caller has
 * established access for the row. Shared by every reader so storage error
 * classes and the R2 access pattern stay identical. Missing objects remain a
 * recoverable product error; R2 I/O failures remain distinguishable from
 * database failures.
 */
export async function loadAttachmentBytes(
  files: AttachmentFileStore,
  attachment: AttachmentRow,
  maxBytes = MAX_MODEL_ATTACHMENT_BYTES,
): Promise<Result<Uint8Array, IssueRunToolError>> {
  return await Result.gen(async function* () {
    // Reject on the stored size before reading an object that has a finite cap.
    if (attachment.sizeBytes > maxBytes) {
      return Result.err(
        new IssueRunToolError({
          code: 'invalid_input',
          message: `Read ${attachment.filename}, but it exceeds the ${formatAttachmentSize(MAX_MODEL_ATTACHMENT_BYTES)} inline model output limit.`,
        }),
      )
    }

    const object = yield* Result.await(
      Result.tryPromise({
        try: async () => await files.get(attachment.r2Key),
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
 * Loads text under the caller's size limit before decoding it. Issue runs pass
 * Infinity to retain their existing large-text reads.
 */
export async function loadAttachmentText(
  files: AttachmentFileStore,
  attachment: AttachmentRow,
  maxBytes = MAX_MODEL_ATTACHMENT_BYTES,
): Promise<Result<string, IssueRunToolError>> {
  const bytesResult = await loadAttachmentBytes(files, attachment, maxBytes)
  if (bytesResult.isErr()) return Result.err(bytesResult.error)
  const bytes = bytesResult.value
  if (bytes.byteLength > maxBytes) {
    return Result.err(
      new IssueRunToolError({
        code: 'invalid_input',
        message: `Read ${attachment.filename}, but it exceeds the ${formatAttachmentSize(MAX_MODEL_ATTACHMENT_BYTES)} inline model output limit.`,
      }),
    )
  }
  return Result.ok(Buffer.from(bytes).toString('utf8'))
}

/**
 * Returns metadata to the transcript while keeping image/PDF bytes out of the
 * public tool result. Think receives those bytes later through toModelOutput.
 * `issueId` overrides the row's own link because comment attachments reach
 * their issue through the parent comment.
 */
export function attachmentMetadata(
  row: AttachmentRow,
  args: { issueId?: string; content?: string } = {},
) {
  const kind = attachmentKind(row.contentType)
  return {
    attachment_id: row.id,
    issue_id: args.issueId ?? row.issueId,
    comment_id: row.commentId,
    filename: row.filename,
    media_type: row.contentType,
    size_bytes: row.sizeBytes,
    kind,
    model_readable: kind === 'image' || kind === 'file' || kind === 'text',
    ...(args.content !== undefined ? { content: args.content } : {}),
    note:
      kind === 'image'
        ? `Read ${row.filename} (${row.contentType}, ${formatAttachmentSize(row.sizeBytes)}). Image bytes are attached privately to the model result.`
        : kind === 'file'
          ? `Read ${row.filename} (${row.contentType}, ${formatAttachmentSize(row.sizeBytes)}). File bytes are attached privately to the model result.`
          : `Read ${row.filename} (${row.contentType}, ${formatAttachmentSize(row.sizeBytes)}).`,
  }
}

/**
 * Converts attachment metadata into model text or private image/PDF parts.
 * `resolveBytes` re-resolves and loads the bytes under the calling tool's own
 * access scope, so issue-run and chat readers share the cap, note text, and
 * part shape without sharing a scope.
 */
export async function attachmentModelOutput(args: {
  output: unknown
  resolveBytes: () => Promise<
    Result<{ attachment: AttachmentRow; bytes: Uint8Array }, string>
  >
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
  if (
    output.kind !== 'image' &&
    output.kind !== 'file' &&
    output.kind !== 'text'
  ) {
    return { type: 'json' as const, value: output as never }
  }

  const resolution = await args.resolveBytes()
  if (resolution.isErr()) {
    return { type: 'error-text' as const, value: resolution.error }
  }
  const { attachment, bytes } = resolution.value
  if (attachmentKind(attachment.contentType) !== output.kind) {
    return {
      type: 'error-text' as const,
      value: `Attachment type ${attachment.contentType} is not supported for this model output.`,
    }
  }
  if (bytes.byteLength > MAX_MODEL_ATTACHMENT_BYTES) {
    return {
      type: 'error-text' as const,
      value: `Read ${attachment.filename}, but it exceeds the ${formatAttachmentSize(MAX_MODEL_ATTACHMENT_BYTES)} inline model output limit.`,
    }
  }

  if (output.kind === 'text') {
    return {
      type: 'text' as const,
      value: Buffer.from(bytes).toString('utf8'),
    }
  }

  const data = Buffer.from(bytes).toString('base64')
  const text =
    typeof output.note === 'string'
      ? output.note
      : `Read ${attachment.filename} (${attachment.contentType}, ${formatAttachmentSize(bytes.byteLength)}).`
  return {
    type: 'content' as const,
    value: [
      { type: 'text' as const, text },
      output.kind === 'image'
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
}

/**
 * Wraps the shared model-output conversion for issue runs, which re-resolve the
 * attachment through the active run's workspace/issue scope.
 */
async function issueAttachmentModelOutput(args: {
  context: IssueRunToolContext
  input: unknown
  output: unknown
}) {
  return await attachmentModelOutput({
    output: args.output,
    resolveBytes: async () => {
      if (!args.input || typeof args.input !== 'object') {
        return Result.err('Invalid attachment reference.')
      }
      const attachmentId = (args.input as { attachment_id?: unknown })
        .attachment_id
      if (typeof attachmentId !== 'string') {
        return Result.err('Invalid attachment reference.')
      }

      const attachmentResult = await loadIssueAttachment({
        context: args.context,
        attachmentId,
      })
      if (attachmentResult.isErr()) {
        return Result.err(attachmentResult.error.message)
      }
      const bytesResult = await loadAttachmentBytes(
        args.context.env.FILES,
        attachmentResult.value,
      )
      if (bytesResult.isErr()) {
        return Result.err(bytesResult.error.message)
      }
      return Result.ok({
        attachment: attachmentResult.value,
        bytes: bytesResult.value,
      })
    },
  })
}

/**
 * Gives issue agents explicit, tenant-scoped access to uploaded evidence.
 * Text is returned directly; images and PDFs use lazy private model parts so
 * screenshot inspection has parity with Think's workspace read behavior.
 */
export function createReadAttachmentTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Read an attachment on the current issue. Use this after the issue body or comments mention an attachment id, especially for screenshots/images. Image inspection requires a vision-capable model. If model output says inspection is unsupported, report that limit instead of describing the image. PDFs also require a model that supports file parts.',
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
        const textResult = await loadAttachmentText(
          context.env.FILES,
          attachment,
          Number.POSITIVE_INFINITY,
        )
        if (textResult.isErr()) return toolErrorResult(textResult.error)
        return toolOkResult(
          attachmentMetadata(attachment, { content: textResult.value }),
        )
      }

      return toolOkResult(attachmentMetadata(attachment))
    },
    toModelOutput: async ({ input, output }) =>
      await issueAttachmentModelOutput({ context, input, output }),
  })
}
