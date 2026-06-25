import { Buffer } from 'node:buffer'
import { eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { MAX_FILE_SIZE } from '@garden/core/constants/upload'
import {
  buildContentDisposition,
  normalizeDownloadFilename,
} from '@garden/agent-runtime'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { badRequest, requireWorkspaceContext } from '@/lib/server/control-plane'
import { toIssueAttachment } from '@garden/server/issues/server'

class IssueAttachmentUploadError extends TaggedError(
  'IssueAttachmentUploadError',
)<{
  message: string
}>() {}

function attachmentStorageKey(input: {
  workspaceId: string
  attachmentId: string
  filename: string
}) {
  return [
    'attachments',
    'workspaces',
    input.workspaceId,
    input.attachmentId,
    normalizeDownloadFilename(input.filename),
  ].join('/')
}

/**
 * Stores editor uploads in the org-scoped FILES R2 bucket layout used by issue
 * descriptions and comments. Before this route, the client posted to
 * `/api/upload-file` but no TanStack Start route existed; image drops therefore
 * produced markdown URLs that agents and users could not reliably reload. The R2
 * key includes workspace/org id (`attachments/workspaces/<workspaceId>/...`) so
 * object layout matches Garden's workspace-scoped skill bundle convention.
 */
export const Route = createFileRoute('/api/upload-file')({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const formResult = await Result.tryPromise({
          try: async () => await request.formData(),
          catch: (cause) =>
            new IssueAttachmentUploadError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (formResult.isErr()) return badRequest(formResult.error.message)

        const file = formResult.value.get('file')
        if (!(file instanceof File)) return badRequest('Missing file')
        if (file.size > MAX_FILE_SIZE)
          return badRequest('File exceeds 100 MB limit')

        const bytesResult = await Result.tryPromise({
          try: async () => Buffer.from(await file.arrayBuffer()),
          catch: (cause) =>
            new IssueAttachmentUploadError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (bytesResult.isErr()) return badRequest(bytesResult.error.message)

        const db = await appContext.db()
        const requestedIssueId =
          formResult.value.get('issue_id')?.toString() || null
        const requestedCommentId =
          formResult.value.get('comment_id')?.toString() || null

        if (requestedIssueId) {
          const [issue] = await db
            .select({ workspaceId: schema.issue.workspaceId })
            .from(schema.issue)
            .where(eq(schema.issue.id, requestedIssueId))
            .limit(1)
          if (!issue || issue.workspaceId !== workspaceContext.workspaceId) {
            return badRequest('Issue attachment target not found')
          }
        }

        if (requestedCommentId) {
          const [comment] = await db
            .select({ workspaceId: schema.issue.workspaceId })
            .from(schema.issueComment)
            .innerJoin(
              schema.issue,
              eq(schema.issue.id, schema.issueComment.issueId),
            )
            .where(eq(schema.issueComment.id, requestedCommentId))
            .limit(1)
          if (
            !comment ||
            comment.workspaceId !== workspaceContext.workspaceId
          ) {
            return badRequest('Comment attachment target not found')
          }
        }

        const attachmentId = crypto.randomUUID()
        const r2Key = attachmentStorageKey({
          workspaceId: workspaceContext.workspaceId,
          attachmentId,
          filename: file.name,
        })
        const contentType = file.type || 'application/octet-stream'

        const putResult = await Result.tryPromise({
          try: async () =>
            await appContext.env.FILES.put(r2Key, bytesResult.value, {
              httpMetadata: {
                contentType,
                contentDisposition: buildContentDisposition(
                  'inline',
                  file.name,
                ),
              },
            }),
          catch: (cause) =>
            new IssueAttachmentUploadError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (putResult.isErr()) return badRequest(putResult.error.message)

        const [row] = await db
          .insert(schema.issueAttachment)
          .values({
            id: attachmentId,
            workspaceId: workspaceContext.workspaceId,
            issueId: requestedIssueId,
            commentId: requestedCommentId,
            uploaderType: 'member',
            uploaderId: workspaceContext.session.user.id,
            filename: file.name,
            r2Key,
            contentType,
            sizeBytes: file.size,
          })
          .returning()

        if (!row) return badRequest('Attachment insert returned no row')
        return Response.json(toIssueAttachment(row), { status: 201 })
      },
    },
  },
})
