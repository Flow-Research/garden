import { eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { buildContentDisposition } from '@garden/agent-runtime'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'

class IssueAttachmentStorageError extends TaggedError(
  'IssueAttachmentStorageError',
)<{
  message: string
}>() {}

/**
 * Serves and deletes issue attachment bytes from FILES only after workspace
 * membership is verified from the attachment row. Before this route, markdown
 * image URLs could point at an API path that did not exist and uploaded objects
 * had no cleanup boundary. After it, agents/users can reload the same stable
 * `/api/attachments/<id>` URLs stored in issue bodies and comments, and the app
 * can remove both the R2 object and database row when an attachment is deleted.
 */
export const Route = createFileRoute('/api/attachments/$id')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [attachment] = await db
          .select()
          .from(schema.issueAttachment)
          .where(eq(schema.issueAttachment.id, params.id))
          .limit(1)
        if (!attachment) return notFound('Attachment not found')

        const access = await requireWorkspaceAccess(
          request,
          attachment.workspaceId,
        )
        if (access instanceof Response) return access

        const objectResult = await Result.tryPromise({
          try: async () => await appContext.env.FILES.get(attachment.r2Key),
          catch: (cause) =>
            new IssueAttachmentStorageError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (objectResult.isErr()) return badRequest(objectResult.error.message)
        if (!objectResult.value) return notFound('Attachment bytes not found')

        const download = new URL(request.url).searchParams.has('download')
        const headers = new Headers()
        objectResult.value.writeHttpMetadata(headers)
        headers.set('Content-Type', attachment.contentType)
        headers.set(
          'Content-Disposition',
          buildContentDisposition(
            download ? 'attachment' : 'inline',
            attachment.filename,
          ),
        )
        headers.set('Cache-Control', 'private, max-age=3600')
        return new Response(objectResult.value.body, { headers })
      },
      DELETE: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [attachment] = await db
          .select()
          .from(schema.issueAttachment)
          .where(eq(schema.issueAttachment.id, params.id))
          .limit(1)
        if (!attachment) return notFound('Attachment not found')

        const access = await requireWorkspaceAccess(
          request,
          attachment.workspaceId,
        )
        if (access instanceof Response) return access

        const deleteObjectResult = await Result.tryPromise({
          try: async () => await appContext.env.FILES.delete(attachment.r2Key),
          catch: (cause) =>
            new IssueAttachmentStorageError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (deleteObjectResult.isErr()) {
          return badRequest(deleteObjectResult.error.message)
        }

        const deleteRowResult = await Result.tryPromise({
          try: async () =>
            await db
              .delete(schema.issueAttachment)
              .where(eq(schema.issueAttachment.id, attachment.id)),
          catch: (cause) =>
            new IssueAttachmentStorageError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (deleteRowResult.isErr()) {
          return badRequest(deleteRowResult.error.message)
        }

        return new Response(null, { status: 204 })
      },
    },
  },
})
