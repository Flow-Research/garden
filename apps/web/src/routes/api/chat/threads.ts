import { and, desc, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  buildAgentHostName,
  ensureAgentRow,
  ensureChatThreadAgent,
  ensureChatThreadAgents,
} from '@/lib/server/chat-agents'
import {
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

        const hostName = buildAgentHostName(workspaceId, session.user.id)
        await ensureAgentRow({
          workspaceId,
          ownerUserId: session.user.id,
          hostName,
        })

        const db = getDb(appEnv)
        const rows = await db
          .select({
            thread: schema.chatThread,
            hostName: schema.agent.hostName,
          })
          .from(schema.chatThread)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.chatThread.agentId),
          )
          .where(
            and(
              eq(schema.chatThread.workspaceId, workspaceId),
              eq(schema.chatThread.ownerUserId, session.user.id),
            ),
          )
          .orderBy(desc(schema.chatThread.updatedAt))

        const usableRows = rows.flatMap((row) =>
          row.hostName ? [{ thread: row.thread, hostName: row.hostName }] : [],
        )

        await ensureChatThreadAgents(
          usableRows.map((row) => ({
            id: row.thread.id,
            hostName: row.hostName,
          })),
        )

        return Response.json(
          usableRows.map((row) => toChatThread(row.thread, row.hostName)),
        )
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

        const id = crypto.randomUUID()
        const hostName = buildAgentHostName(workspaceId, session.user.id)
        const now = new Date()
        const db = getDb(appEnv)

        const agentRow = await ensureAgentRow({
          workspaceId,
          ownerUserId: session.user.id,
          hostName,
        })

        const [thread] = await db
          .insert(schema.chatThread)
          .values({
            id,
            workspaceId,
            ownerUserId: session.user.id,
            agentId: agentRow.id,
            title,
            lastMessage: '',
            createdAt: now,
            updatedAt: now,
          })
          .returning()

        await ensureChatThreadAgent({
          threadId: thread.id,
          hostName,
        })

        return Response.json(toChatThread(thread, hostName), { status: 201 })
      },
    },
  },
})
