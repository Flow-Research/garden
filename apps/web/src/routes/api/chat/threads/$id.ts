import { and, eq } from 'drizzle-orm'
import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  updateChatThreadBodySchema,
} from '@/lib/server/validation/chat'
import {
  deleteChatThreadAgent,
  pauseChatThreadAgent,
} from '@/lib/server/chat-agents'
import { schema } from '@/lib/server/db'
import { badRequest, notFound, toChatThread } from '@/lib/server/control-plane'
import { getThreadAccess } from '@/lib/server/chat-threads'
import { createGardenLogger } from '@garden/observability/logger'

const logger = createGardenLogger({
  service: 'garden-staging',
  component: 'chat-threads-api',
})

export const Route = createFileRoute('/api/chat/threads/$id')({
  server: {
    handlers: {
      PATCH: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await getThreadAccess(appContext, params.id)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          updateChatThreadBodySchema,
          'Invalid chat thread payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        // Prefer caller-supplied updatedAt when provided. Clients attach it
        // to keep sidebar ordering monotonic across optimistic updates and
        // server round-trips; fall back to now when absent.
        const clientUpdatedAt =
          typeof body.updatedAt === 'string' ? new Date(body.updatedAt) : null
        const updateValues: Partial<typeof schema.chatThread.$inferInsert> = {
          updatedAt:
            clientUpdatedAt && !Number.isNaN(clientUpdatedAt.getTime())
              ? clientUpdatedAt
              : new Date(),
        }

        if (typeof body.title === 'string') {
          updateValues.title = body.title
        }

        if (typeof body.lastMessage === 'string') {
          updateValues.lastMessage = body.lastMessage
        }

        if (Object.prototype.hasOwnProperty.call(body, 'archivedAt')) {
          updateValues.archivedAt = body.archivedAt
            ? new Date(body.archivedAt)
            : null
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

        if (updateValues.archivedAt) {
          const pauseResult = await Result.tryPromise({
            try: async () =>
              await pauseChatThreadAgent({
                threadId: access.thread.id,
                hostName: access.hostName,
              }),
            catch: (cause) =>
              cause instanceof Error ? cause.message : String(cause),
          })
          if (pauseResult.isErr()) {
            logger.warn('chat_thread.archive_pause_failed', {
              threadId: access.thread.id,
              message: pauseResult.error,
            })
          }
        }

        return Response.json(toChatThread(thread, access.hostName))
      },
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await getThreadAccess(appContext, params.id)
        if (access instanceof Response) return access

        await deleteChatThreadAgent({
          threadId: access.thread.id,
          hostName: access.hostName,
        })

        await access.db
          .delete(schema.chatThread)
          .where(
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
