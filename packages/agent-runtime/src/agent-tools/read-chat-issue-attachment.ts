import { Result } from 'better-result'
import { and, eq, inArray, or } from 'drizzle-orm'
import { tool } from 'ai'
import { getPooledDb } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import { readIssue } from '@garden/server/issues/server'
import { z } from 'zod'
import {
  attachmentKind,
  attachmentMetadata,
  attachmentModelOutput,
  formatAttachmentSize,
  loadAttachmentBytes,
  MAX_MODEL_ATTACHMENT_BYTES,
  type AttachmentFileStore,
  type AttachmentRow,
} from './read-attachment'

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

const CHAT_ATTACHMENT_TOOL_KEY = 'read_issue_attachment'

type ReadChatIssueAttachmentContext = {
  databaseUrl: string
  threadId: string
  files: AttachmentFileStore
  /**
   * Live permission check for this tool. Think can rebuild a stored tool result
   * on a later turn without calling `execute`, so the policy decision has to be
   * asked again at the byte-read boundary instead of only when the turn starts.
   */
  canUseTool?: (runtimeToolName: string) => Promise<boolean> | boolean
}

type ScopedAttachment = {
  attachment: AttachmentRow
  issueId: string
}

/** Denial text for the current agent/Team policy, or null when the tool is allowed. */
async function policyDenial(
  context: ReadChatIssueAttachmentContext,
): Promise<string | null> {
  if (!context.canUseTool) {
    return 'Could not verify current attachment permissions.'
  }
  const decision = await Result.tryPromise({
    try: async () => await context.canUseTool?.(CHAT_ATTACHMENT_TOOL_KEY),
    catch: () => 'Could not verify current attachment permissions.',
  })
  return decision.match({
    ok: (allowed) =>
      allowed
        ? null
        : 'Reading issue attachments is not allowed by the current agent or Team policy.',
    err: (message) => message,
  })
}

/**
 * Resolves the requested issue from this chat's workspace before looking up
 * the attachment. Regular chats previously had issue metadata but no way to
 * inspect its bytes; this scoped lookup follows the issue-run reader's R2 path
 * and includes comment attachments linked through their parent comment. The
 * scope mirrors `read-attachment.ts` and the issue/comment attachment joins in
 * `packages/server/src/issues/server.ts`. Everything after this access check is
 * shared with the issue-run reader.
 */
async function loadChatIssueAttachment(
  context: ReadChatIssueAttachmentContext,
  input: z.infer<typeof readChatIssueAttachmentInputSchema>,
): Promise<Result<ScopedAttachment, string>> {
  return Result.gen(async function* () {
    const db = getPooledDb(context.databaseUrl)
    const threadResult = Result.tryPromise({
      try: async () => {
        const threads = await db
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
          .limit(2)
        return threads.length === 1 ? threads[0] : null
      },
      catch: (cause) =>
        `Could not load chat workspace: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    const thread = yield* Result.await(threadResult)
    if (!thread) return Result.err('Chat thread not found.')

    // `readIssue` reads the owner's member row only for the manager flag, so a
    // removed owner still passes the Team rule for Team-less issues. Require a
    // current membership row here, before any issue or attachment lookup.
    const membershipResult = Result.tryPromise({
      try: async () => {
        const [membership] = await db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, thread.workspaceId),
              eq(schema.member.userId, thread.ownerUserId),
            ),
          )
          .limit(1)
        return membership ?? null
      },
      catch: (cause) =>
        `Could not load chat owner membership: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    const membership = yield* Result.await(membershipResult)
    if (!membership) {
      return Result.err('Chat owner no longer belongs to this workspace.')
    }

    const issueResult = await readIssue({
      databaseUrl: context.databaseUrl,
      workspaceId: thread.workspaceId,
      viewerUserId: thread.ownerUserId,
      issueIdOrIdentifier: input.issue_id_or_identifier,
    })
    if (issueResult.isErr()) return Result.err(issueResult.error.message)

    const issueCommentIds = db
      .select({ id: schema.issueComment.id })
      .from(schema.issueComment)
      .where(eq(schema.issueComment.issueId, issueResult.value.issue_id))

    const attachmentResult = Result.tryPromise({
      try: async () => {
        const [attachment] = await db
          .select()
          .from(schema.issueAttachment)
          .where(
            and(
              eq(schema.issueAttachment.id, input.attachment_id),
              eq(schema.issueAttachment.workspaceId, thread.workspaceId),
              or(
                eq(schema.issueAttachment.issueId, issueResult.value.issue_id),
                inArray(schema.issueAttachment.commentId, issueCommentIds),
              ),
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
 * Gives regular chat agents a workspace- and issue-scoped attachment reader.
 * Image/PDF bytes are attached only to model output, never durable tool output.
 * The cap, kind mapping, byte loading, metadata, and private model parts are
 * shared with `read-attachment.ts`; only the chat access check lives here.
 */
export function createReadChatIssueAttachmentTool(
  context: ReadChatIssueAttachmentContext,
) {
  return tool({
    description:
      'Read an attachment on a Garden issue. First use read_issue, then provide its issue identifier and attachment id. Image inspection requires a vision-capable model. If model output says inspection is unsupported, report that limit instead of describing the image. PDFs also require a model that supports file parts.',
    inputSchema: readChatIssueAttachmentInputSchema,
    execute: async (input) => {
      const denial = await policyDenial(context)
      if (denial) return { error: denial }

      const scopedResult = await loadChatIssueAttachment(context, input)
      if (scopedResult.isErr()) return { error: scopedResult.error }

      const { attachment } = scopedResult.value
      if (
        attachmentKind(attachment.contentType) === 'text' &&
        attachment.sizeBytes > MAX_MODEL_ATTACHMENT_BYTES
      ) {
        return {
          error: `Read ${attachment.filename}, but it exceeds the ${formatAttachmentSize(MAX_MODEL_ATTACHMENT_BYTES)} inline model output limit.`,
        }
      }

      return attachmentMetadata(attachment, {
        issueId: scopedResult.value.issueId,
      })
    },
    toModelOutput: async ({ input, output }) => {
      const denial = await policyDenial(context)
      if (denial) return { type: 'error-text' as const, value: denial }
      const replayOutput =
        output && typeof output === 'object' && 'content' in output
          ? { ...output, content: undefined }
          : output
      return await attachmentModelOutput({
        output: replayOutput,
        resolveBytes: async () => {
          const parsedInput =
            readChatIssueAttachmentInputSchema.safeParse(input)
          if (!parsedInput.success) {
            return Result.err('Invalid attachment reference.')
          }
          const scopedResult = await loadChatIssueAttachment(
            context,
            parsedInput.data,
          )
          if (scopedResult.isErr()) return Result.err(scopedResult.error)
          const { attachment } = scopedResult.value
          const currentDenial = await policyDenial(context)
          if (currentDenial) return Result.err(currentDenial)
          const bytesResult = await loadAttachmentBytes(
            context.files,
            attachment,
          )
          if (bytesResult.isErr()) {
            return Result.err(bytesResult.error.message)
          }
          return Result.ok({ attachment, bytes: bytesResult.value })
        },
      })
    },
  })
}
