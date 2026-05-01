import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { buildContentDisposition } from '@garden/agent-runtime'
import { readChatThreadDocumentBytes } from '@/lib/server/chat-agents'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  forbidden,
  notFound,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

class DocumentDownloadError extends TaggedError('DocumentDownloadError')<{
  message: string
}>() {}

export const Route = createFileRoute('/api/documents/$id/docx')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const routeParams = params as { id: string }
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const db = getDb(appEnv)
        const rowResult = await Result.tryPromise({
          try: async () => {
            const [row] = await db
              .select({
                workspaceId: schema.document.workspaceId,
                ownerUserId: schema.document.ownerUserId,
                filename: schema.document.filename,
                fileType: schema.document.fileType,
                threadId: schema.document.threadId,
                hostName: schema.agent.hostName,
              })
              .from(schema.document)
              .innerJoin(schema.chatThread, eq(schema.document.threadId, schema.chatThread.id))
              .innerJoin(schema.agent, eq(schema.chatThread.agentId, schema.agent.id))
              .where(eq(schema.document.id, routeParams.id))
              .limit(1)
            return row ?? null
          },
          catch: (error) =>
            new DocumentDownloadError({
              message: error instanceof Error ? error.message : String(error),
            }),
        })
        if (rowResult.isErr()) {
          return Response.json({ error: rowResult.error.message }, { status: 500 })
        }
        if (!rowResult.value) return notFound('Document not found')

        const membership = await db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, rowResult.value.workspaceId),
              eq(schema.member.userId, session.user.id),
            ),
          )
          .limit(1)
        if (!membership[0] && rowResult.value.ownerUserId !== session.user.id) {
          return forbidden('Document access denied')
        }

        if (!rowResult.value.threadId || !rowResult.value.hostName) {
          return notFound('Document agent workspace not found')
        }

        const bytesResult = (await readChatThreadDocumentBytes({
          threadId: rowResult.value.threadId,
          hostName: rowResult.value.hostName,
          documentId: routeParams.id,
        })) as
          | {
              ok: true
              base64: string
              filename?: string | null
              media_type?: string | null
            }
          | { ok: false; error?: string }
        if (!bytesResult?.ok) {
          return Response.json(
            { error: bytesResult?.error ?? 'Document bytes not found' },
            { status: 404 },
          )
        }
        const bytes = Buffer.from(bytesResult.base64, 'base64')

        const filename =
          new URL(request.url).searchParams.get('filename') ??
          bytesResult.filename ??
          rowResult.value.filename
        return new Response(bytes, {
          headers: {
            'Content-Type': bytesResult.media_type ?? contentTypeForFileType(rowResult.value.fileType),
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
