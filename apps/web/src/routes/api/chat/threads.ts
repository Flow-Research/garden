import { and, desc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  bindExistingCapabilitiesToAgent,
  bindExistingSkillsToAgent,
} from '@/lib/server/agent-bindings'
import {
  createChatThreadBodySchema,
  parseJsonBody,
} from '@/lib/server/api-validation'
import { buildAgentHostName, ensureAgentRow } from '@/lib/server/chat-agents'
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

const NEW_CHAT_TITLE = 'New Chat'

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
        const title = requestedTitle || NEW_CHAT_TITLE
        const shouldClaimWarmThread = title === NEW_CHAT_TITLE
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

        const thread = await db.transaction(async (tx) => {
          await tx.execute(sql`
            select pg_advisory_xact_lock(
              hashtext(${`${workspaceId}:${session.user.id}:${agentRow.id}:warm-chat`})
            )
          `)

          if (shouldClaimWarmThread) {
            // Exclude any thread the caller has already disqualified — e.g.,
            // a previous turn errored and the client doesn't want the same
            // broken row recycled as the next warm thread. Without this, the
            // client-side `erroredSessionIds` bookkeeping is undone here at
            // the API edge.
            const excludeIds = body.exclude_thread_ids ?? []
            const [existingThread] = await tx
              .select()
              .from(schema.chatThread)
              .where(
                and(
                  eq(schema.chatThread.workspaceId, workspaceId),
                  eq(schema.chatThread.ownerUserId, session.user.id),
                  eq(schema.chatThread.agentId, agentRow.id),
                  eq(schema.chatThread.title, NEW_CHAT_TITLE),
                  eq(schema.chatThread.lastMessage, ''),
                  isNull(schema.chatThread.archivedAt),
                  ...(excludeIds.length > 0
                    ? [notInArray(schema.chatThread.id, excludeIds)]
                    : []),
                ),
              )
              .orderBy(desc(schema.chatThread.updatedAt))
              .limit(1)

            if (existingThread) return existingThread
          }

          const [createdThread] = await tx
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

          return createdThread
        })

        return Response.json(toChatThread(thread, agentHostName), {
          status: 201,
        })
      },
    },
  },
})
