import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { schema } from '@/lib/server/db'
import {
  deleteChatThreadAgent,
  ensureAgentRow,
  getChatThreadMessages,
} from '@/lib/server/chat-agents'
import {
  badRequest,
  toChatThread,
  notFound,
} from '@/lib/server/control-plane'
import { getThreadAccess } from '@/lib/server/chat-threads'

export const Route = createFileRoute('/api/chat/threads/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        // Ensure-and-fetch in parallel where possible: the DB upsert for the
        // agent control-plane row is independent of the DO facet. The DO
        // call also provisions the facet (subAgent is idempotent) and returns
        // the current message log in the same RPC, collapsing what used to
        // be ensure + getMessages into one round trip from the client.
        const [, messages] = await Promise.all([
          ensureAgentRow({
            workspaceId: access.thread.workspaceId,
            ownerUserId: access.session.user.id,
            hostName: access.hostName,
          }),
          getChatThreadMessages({
            threadId: access.thread.id,
            hostName: access.hostName,
          }),
        ])

        return Response.json({
          thread: toChatThread(access.thread, access.hostName),
          messages,
        })
      },
      PATCH: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null

        // Prefer caller-supplied updatedAt when provided. Clients attach it
        // to keep sidebar ordering monotonic across optimistic updates and
        // server round-trips; fall back to now when absent.
        const clientUpdatedAt =
          typeof body?.updatedAt === 'string'
            ? new Date(body.updatedAt)
            : null
        const updateValues: Partial<typeof schema.chatThread.$inferInsert> = {
          updatedAt:
            clientUpdatedAt && !Number.isNaN(clientUpdatedAt.getTime())
              ? clientUpdatedAt
              : new Date(),
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
        return Response.json(toChatThread(thread, access.hostName))
      },
      DELETE: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        await deleteChatThreadAgent({
          threadId: access.thread.id,
          hostName: access.hostName,
        })

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
