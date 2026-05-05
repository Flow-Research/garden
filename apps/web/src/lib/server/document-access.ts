import { and, eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  forbidden,
  notFound,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

class DocumentAccessError extends TaggedError('DocumentAccessError')<{
  message: string
}>() {}

export async function getChatDocumentAccess(
  request: Request,
  documentId: string,
) {
  const session = await requireSession(request)
  if (!session) return unauthorized()

  const db = getDb(appEnv)
  const rowResult = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select({
          filename: schema.document.filename,
          fileType: schema.document.fileType,
          hostName: schema.agent.hostName,
          ownerUserId: schema.document.ownerUserId,
          threadId: schema.document.threadId,
          workspaceId: schema.document.workspaceId,
        })
        .from(schema.document)
        .innerJoin(
          schema.chatThread,
          eq(schema.document.threadId, schema.chatThread.id),
        )
        .innerJoin(schema.agent, eq(schema.chatThread.agentId, schema.agent.id))
        .where(eq(schema.document.id, documentId))
        .limit(1)
      return row ?? null
    },
    catch: (error) =>
      new DocumentAccessError({
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
  const row = {
    ...rowResult.value,
    hostName: rowResult.value.hostName,
    threadId: rowResult.value.threadId,
  }

  return {
    db,
    row,
    session,
  }
}
