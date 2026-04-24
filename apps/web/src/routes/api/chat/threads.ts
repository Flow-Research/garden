import { and, desc, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  createChatThreadBodySchema,
  parseJsonBody,
} from '@/lib/server/api-validation'
import {
  buildPrimaryAgentName,
  ensurePrimaryControlPlaneAgent,
  ensureChatThreadAgent,
  ensureChatThreadAgents,
} from '@/lib/server/chat-agents'
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

        await ensurePrimaryControlPlaneAgent({
          workspaceId,
          ownerUserId: session.user.id,
          agentName: buildPrimaryAgentName(workspaceId, session.user.id),
        })

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

        await ensureChatThreadAgents(rows)

        return Response.json(rows.map(toChatThread))
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return Response.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const bodyResult = await parseJsonBody(
          request,
          createChatThreadBodySchema,
          'Invalid chat thread payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const requestedTitle = typeof body.title === 'string' ? body.title : ''
        const title = requestedTitle || 'New Chat'
        if (!title) {
          return badRequest('Chat title is required')
        }

        const id = crypto.randomUUID()
        const agentName = buildPrimaryAgentName(workspaceId, session.user.id)
        const now = new Date()
        const db = getDb(appEnv)

        await ensurePrimaryControlPlaneAgent({
          workspaceId,
          ownerUserId: session.user.id,
          agentName,
        })

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

        await ensureChatThreadAgent({
          threadId: thread.id,
          agentName: thread.agentName,
        })

        return Response.json(toChatThread(thread), { status: 201 })
      },
    },
  },
})
