import { Buffer } from 'node:buffer'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { Result } from 'better-result'
import {
  buildContentDisposition,
  resolveTrackedChange,
} from '@garden/agent-runtime'
import { schema } from '@/lib/server/db'
import { readChatThreadDocumentVersionBytes } from '@/lib/server/chat-agents'
import { getChatDocumentAccess } from '@/lib/server/document-access'

type ChatDocumentAccess = Exclude<
  Awaited<ReturnType<typeof getChatDocumentAccess>>,
  Response
>

export const Route = createFileRoute('/api/documents/$id/docx')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const routeParams = params as { id: string }
        const access = await getChatDocumentAccess(request, routeParams.id)
        if (access instanceof Response) return access

        const url = new URL(request.url)
        const bytesResult = (await readChatThreadDocumentVersionBytes({
          threadId: access.row.threadId,
          hostName: access.row.hostName,
          documentId: routeParams.id,
          versionId: url.searchParams.get('version_id'),
        })) as
          | {
              ok: true
              base64: string
              file_type?: string | null
              filename?: string | null
              media_type?: string | null
              version_id?: string | null
            }
          | { ok: false; error?: string }
        if (!bytesResult?.ok) {
          return Response.json(
            { error: bytesResult?.error ?? 'Document bytes not found' },
            { status: 404 },
          )
        }
        const reviewMode = url.searchParams.get('review') === '1'
        const rawBytes = Buffer.from(bytesResult.base64, 'base64')
        const bytes =
          reviewMode || bytesResult.file_type !== 'docx'
            ? rawBytes
            : await cleanDocxDownloadBytes({
                access,
                bytes: rawBytes,
                documentId: routeParams.id,
                versionId: bytesResult.version_id ?? null,
              })

        const filename =
          url.searchParams.get('filename') ??
          bytesResult.filename ??
          access.row.filename
        return new Response(toArrayBuffer(bytes), {
          headers: {
            'Content-Type':
              bytesResult.media_type ??
              contentTypeForFileType(access.row.fileType),
            'Content-Disposition': buildContentDisposition(
              'attachment',
              filename,
            ),
          },
        })
      },
    },
  },
})

async function cleanDocxDownloadBytes({
  access,
  bytes,
  documentId,
  versionId,
}: {
  access: ChatDocumentAccess
  bytes: Buffer
  documentId: string
  versionId: string | null
}) {
  if (!versionId) return bytes

  const rows = await access.db
    .select({ changeId: schema.documentEdit.changeId })
    .from(schema.documentEdit)
    .where(
      and(
        eq(schema.documentEdit.documentId, documentId),
        eq(schema.documentEdit.versionId, versionId),
        eq(schema.documentEdit.status, 'pending'),
      ),
    )
  const changeIds = rows.map((row) => row.changeId).filter(Boolean)
  if (changeIds.length === 0) return bytes

  const result = await Result.tryPromise({
    try: async () => await resolveTrackedChange(bytes, changeIds, 'accept'),
    catch: () => null,
  })
  if (result.isErr() || !result.value?.found) return bytes
  return result.value.bytes
}

function toArrayBuffer(bytes: Buffer) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function contentTypeForFileType(fileType: string) {
  switch (fileType) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'doc':
      return 'application/msword'
    case 'pdf':
      return 'application/pdf'
    case 'txt':
    case 'md':
      return 'text/plain; charset=utf-8'
    case 'json':
      return 'application/json'
    case 'csv':
      return 'text/csv'
    default:
      return 'application/octet-stream'
  }
}
