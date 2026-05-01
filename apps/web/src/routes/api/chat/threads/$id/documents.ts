import { Buffer } from 'node:buffer'
import { Result, TaggedError } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq } from 'drizzle-orm'
import { uploadChatThreadDocument } from '@/lib/server/chat-agents'
import { badRequest } from '@/lib/server/control-plane'
import { documentDownloadUrl } from '@garden/agent-runtime'
import { schema } from '@/lib/server/db'
import { getThreadAccess } from '@/lib/server/chat-threads'

class DocumentUploadError extends TaggedError('DocumentUploadError')<{
  message: string
}>() {}

export const Route = createFileRoute('/api/chat/threads/$id/documents')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const routeParams = params as { id: string }
        const access = await getThreadAccess(request, routeParams.id)
        if (access instanceof Response) return access

        const rows = await access.db
          .select({
            id: schema.document.id,
            filename: schema.document.filename,
            fileType: schema.document.fileType,
            status: schema.document.status,
            sizeBytes: schema.document.sizeBytes,
            versionId: schema.documentVersion.id,
            versionNumber: schema.documentVersion.versionNumber,
            updatedAt: schema.document.updatedAt,
          })
          .from(schema.document)
          .leftJoin(
            schema.documentVersion,
            eq(schema.document.currentVersionId, schema.documentVersion.id),
          )
          .where(
            and(
              eq(schema.document.threadId, access.thread.id),
              eq(schema.document.workspaceId, access.thread.workspaceId),
            ),
          )
          .orderBy(desc(schema.document.updatedAt))

        return Response.json({
          ok: true,
          attachments: rows.map((row) => ({
            id: row.id,
            filename: row.filename,
            file_type: row.fileType,
            status: row.status,
            size_bytes: row.sizeBytes,
            version_id: row.versionId,
            version_number: row.versionNumber,
            download_url: documentDownloadUrl(row.id, row.filename),
            updated_at: row.updatedAt?.toISOString() ?? null,
          })),
        })
      },
      POST: async ({ request, params }) => {
        const routeParams = params as { id: string }
        const access = await getThreadAccess(request, routeParams.id)
        if (access instanceof Response) return access

        const formResult = await Result.tryPromise({
          try: async () => await request.formData(),
          catch: (error) =>
            new DocumentUploadError({
              message: error instanceof Error ? error.message : String(error),
            }),
        })
        if (formResult.isErr()) return badRequest(formResult.error.message)

        const file = formResult.value.get('file')
        if (!(file instanceof File)) return badRequest('Missing document file')

        const bytesResult = await Result.tryPromise({
          try: async () => Buffer.from(await file.arrayBuffer()),
          catch: (error) =>
            new DocumentUploadError({
              message: error instanceof Error ? error.message : String(error),
            }),
        })
        if (bytesResult.isErr()) return badRequest(bytesResult.error.message)

        const result = await uploadChatThreadDocument({
          threadId: access.thread.id,
          hostName: access.hostName,
          filename: file.name,
          mediaType: file.type || null,
          base64: bytesResult.value.toString('base64'),
        })

        return Response.json(result, { status: result?.ok ? 201 : 400 })
      },
    },
  },
})
