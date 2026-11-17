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
  loadAttachmentBytes,
  loadAttachmentText,
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
  canUseTool?: (runtimeToolName: string) => boolean
}

type ScopedAttachment = {
  attachment: AttachmentRow
  issueId: string
}

/** Denial text for the current agent/Team policy, or null when the tool is allowed. */
function policyDenial(context: ReadChatIssueAttachmentContext): string | null {
  return context.canUseTool?.(CHAT_ATTACHMENT_TOOL_KEY) === false
    ? 'Reading issue attachments is not allowed by the current agent or Team policy.'
    : null
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
      'Read an attachment on a Garden issue. First use read_issue, then provide its issue identifier and attachment id. Images and PDFs are passed privately to the model for inspection.',
    inputSchema: readChatIssueAttachmentInputSchema,
    execute: async (input) => {
      const denial = policyDenial(context)
      if (denial) return { error: denial }

      const scopedResult = await loadChatIssueAttachment(context, input)
      if (scopedResult.isErr()) return { error: scopedResult.error }

      const { attachment } = scopedResult.value
      let content: string | undefined
      if (attachmentKind(attachment.contentType) === 'text') {
        const textResult = await loadAttachmentText(context.files, attachment)
        if (textResult.isErr()) return { error: textResult.error.message }
        content = textResult.value
      }

      return attachmentMetadata(attachment, {
        issueId: scopedResult.value.issueId,
        ...(content === undefined ? {} : { content }),
      })
    },
    toModelOutput: async ({ input, output }) =>
      await attachmentModelOutput({
        output,
        resolveBytes: async () => {
          const denial = policyDenial(context)
          if (denial) return Result.err(denial)

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
          const bytesResult = await loadAttachmentBytes(
            context.files,
            attachment,
          )
          if (bytesResult.isErr()) {
            return Result.err(bytesResult.error.message)
          }
          return Result.ok({ attachment, bytes: bytesResult.value })
        },
      }),
  })
}
