import { and, desc, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  requireSession,
  resolveWorkspaceId,
  toChatThread,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/chat/threads')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json([])

        const db = getDb(appEnv)
        const rows = await db
          .select()
          .from(schema.chatThread)
          .where(
            and(
              eq(schema.chatThread.workspaceId, workspaceId),
              eq(schema.chatThread.ownerUserId, session.user.id),
            ),
          )
          .orderBy(desc(schema.chatThread.updatedAt))

        return Response.json(rows.map(toChatThread))
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return Response.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        const requestedTitle =
          typeof body?.title === 'string' ? body.title.trim() : ''
        const title = requestedTitle || 'New Chat'
        if (!title) {
          return badRequest('Chat title is required')
        }

        const id = crypto.randomUUID()
        const agentName = `chat:${id}`
        const now = new Date()
        const db = getDb(appEnv)
        const [thread] = await db
          .insert(schema.chatThread)
          .values({
            id,
            workspaceId,
            ownerUserId: session.user.id,
            title,
            agentName,
            lastMessage: '',
            createdAt: now,
            updatedAt: now,
          })
          .returning()

        return Response.json(toChatThread(thread), { status: 201 })
      },
    },
  },
})
