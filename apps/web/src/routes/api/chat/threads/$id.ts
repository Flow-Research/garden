import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireSession,
  requireWorkspaceAccess,
  toChatThread,
  unauthorized,
} from '@/lib/server/control-plane'

async function getThreadAccess(request: Request, threadId: string) {
  const session = await requireSession(request)
  if (!session) return unauthorized()

  const db = getDb(appEnv)
  const [thread] = await db
    .select()
    .from(schema.chatThread)
    .where(eq(schema.chatThread.id, threadId))

  if (!thread) return notFound('Chat thread not found')
  if (thread.ownerUserId !== session.user.id) {
    return notFound('Chat thread not found')
  }

  const access = await requireWorkspaceAccess(request, thread.workspaceId)
  if (access instanceof Response) return access

  return { db, session, thread }
}

export const Route = createFileRoute('/api/chat/threads/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        return Response.json(toChatThread(access.thread))
      },
      PATCH: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        const updateValues: Partial<typeof schema.chatThread.$inferInsert> = {
          updatedAt: new Date(),
        }

        if (typeof body?.title === 'string') {
          const title = body.title.trim()
          if (!title) {
            return badRequest('Chat title is required')
          }
          updateValues.title = title
        }

        if (typeof body?.lastMessage === 'string') {
          updateValues.lastMessage = body.lastMessage
        }

        if (body && Object.prototype.hasOwnProperty.call(body, 'archivedAt')) {
          updateValues.archivedAt =
            typeof body.archivedAt === 'string' ? new Date(body.archivedAt) : null
        }

        const [thread] = await access.db
          .update(schema.chatThread)
          .set(updateValues)
          .where(
            and(
              eq(schema.chatThread.id, params.id),
              eq(schema.chatThread.workspaceId, access.thread.workspaceId),
              eq(schema.chatThread.ownerUserId, access.session.user.id),
            ),
          )
          .returning()

        if (!thread) return notFound('Chat thread not found')
        return Response.json(toChatThread(thread))
      },
      DELETE: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        await access.db.delete(schema.chatThread).where(
          and(
            eq(schema.chatThread.id, params.id),
            eq(schema.chatThread.workspaceId, access.thread.workspaceId),
            eq(schema.chatThread.ownerUserId, access.session.user.id),
          ),
        )

        return new Response(null, { status: 204 })
      },
    },
  },
})
