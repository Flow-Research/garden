import { and, desc, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  bindExistingCapabilitiesToAgent,
  bindExistingSkillsToAgent,
} from '@/lib/server/agent-bindings'
import {
  createChatThreadBodySchema,
  parseJsonBody,
} from '@/lib/server/api-validation'
import {
  buildAgentHostName,
  ensureAgentRow,
  ensureChatThreadAgent,
  ensureChatThreadAgents,
} from '@/lib/server/chat-agents'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  forbidden,
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
          return Response.json(
            { error: 'Workspace not found' },
            { status: 404 },
          )
        }

        const bodyResult = await parseJsonBody(
          request,
          createChatThreadBodySchema,
          'Invalid chat thread payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const requestedTitle = body.title ?? ''
        const title = requestedTitle || 'New Chat'
        const id = crypto.randomUUID()
        const hostName = buildAgentHostName(workspaceId, session.user.id)
        const now = new Date()
        const db = getDb(appEnv)

        const defaultAgentRow = await ensureAgentRow({
          workspaceId,
          ownerUserId: session.user.id,
          hostName,
        })
        const requestedAgentId = body.agent_id ?? ''

        const agentRow = requestedAgentId
          ? (
              await db
                .select()
                .from(schema.agent)
                .where(eq(schema.agent.id, requestedAgentId))
                .limit(1)
            )[0]
          : defaultAgentRow

        if (!agentRow || agentRow.workspaceId !== workspaceId) {
          return forbidden('Agent access denied')
        }

        const agentHostName = agentRow.hostName ?? hostName
        if (!agentRow.hostName) {
          await db
            .update(schema.agent)
            .set({ hostName: agentHostName })
            .where(eq(schema.agent.id, agentRow.id))
        }
        await bindExistingSkillsToAgent({
          db,
          schema,
          agentId: agentRow.id,
          workspaceId,
        })
        await bindExistingCapabilitiesToAgent({
          db,
          schema,
          agentId: agentRow.id,
          grantedBy: session.user.id,
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
          hostName: agentHostName,
        })

        return Response.json(toChatThread(thread, agentHostName), {
          status: 201,
        })
      },
    },
  },
})
