import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  debugChatThreadMeta,
  debugChatThreadPrompt,
  debugChatThreadSandbox,
  debugChatThreadTools,
  debugChatThreadWorkspace,
  refreshChatThreadPromptConfig,
} from '@/lib/server/chat-agents'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  parseJsonBody,
  parseSearchParams,
  refreshThreadDebugBodySchema,
  threadDebugQuerySchema,
} from '@/lib/server/validation/chat'
import {
  badRequest,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'

/**
 * SSE debug stream. Each section of the agent debug snapshot is fetched in
 * parallel and flushed to the client as it resolves, so the drawer renders
 * progressively instead of waiting on a single blob.
 *
 * Events: `meta` | `tools` | `workspace` | `sandbox` | `error` | `done`
 */
export const Route = createFileRoute('/api/debug-stream')({
  server: {
    handlers: {
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
          refreshThreadDebugBodySchema,
          'Invalid debug refresh payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const searchResult = parseSearchParams(
          request,
          threadDebugQuerySchema,
          'Invalid debug query',
        )
        if (searchResult.isErr()) return badRequest(searchResult.error.message)

        const threadId =
          searchResult.value.thread_id ??
          searchResult.value.session_id ??
          undefined

        if (!threadId) return badRequest('Chat thread is required')

        const db = getDb(appEnv)
        const [thread] = await db
          .select({
            hostName: schema.agent.hostName,
            ownerUserId: schema.chatThread.ownerUserId,
            workspaceId: schema.chatThread.workspaceId,
          })
          .from(schema.chatThread)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.chatThread.agentId),
          )
          .where(eq(schema.chatThread.id, threadId))

        if (
          !thread ||
          thread.ownerUserId !== session.user.id ||
          thread.workspaceId !== workspaceId ||
          !thread.hostName
        ) {
          return Response.json(
            { error: 'Chat thread not found' },
            { status: 404 },
          )
        }

        if (bodyResult.value.action === 'refresh_prompt') {
          await refreshChatThreadPromptConfig({
            threadId,
            hostName: thread.hostName,
          })
        }

        return Response.json({ ok: true })
      },
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return Response.json(
            { error: 'Workspace not found' },
            { status: 404 },
          )
        }

        const searchResult = parseSearchParams(
          request,
          threadDebugQuerySchema,
          'Invalid debug query',
        )
        if (searchResult.isErr()) return badRequest(searchResult.error.message)

        const threadId =
          searchResult.value.thread_id ??
          searchResult.value.session_id ??
          undefined

        if (!threadId) {
          return new Response(null, { status: 204 })
        }

        const db = getDb(appEnv)
        const [thread] = await db
          .select({
            hostName: schema.agent.hostName,
            ownerUserId: schema.chatThread.ownerUserId,
            workspaceId: schema.chatThread.workspaceId,
          })
          .from(schema.chatThread)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.chatThread.agentId),
          )
          .where(eq(schema.chatThread.id, threadId))

        if (
          !thread ||
          thread.ownerUserId !== session.user.id ||
          thread.workspaceId !== workspaceId ||
          !thread.hostName
        ) {
          return Response.json(
            { error: 'Chat thread not found' },
            { status: 404 },
          )
        }

        const encoder = new TextEncoder()
        const hostName = thread.hostName

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (event: string, data: unknown) => {
              controller.enqueue(
                encoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              )
            }

            emit('open', {
              workspaceId,
              threadId,
              generatedAt: new Date().toISOString(),
            })

            const wrap = async <T>(event: string, run: () => Promise<T>) => {
              const res = await run().then(
                (data) => ({ ok: true as const, data }),
                (cause: unknown) => ({ ok: false as const, cause }),
              )
              if (res.ok) {
                emit(event, res.data)
              } else {
                emit('error', {
                  section: event,
                  message:
                    res.cause instanceof Error
                      ? res.cause.message
                      : String(res.cause),
                })
              }
            }

            const tasks = [
              wrap('meta', () => debugChatThreadMeta({ threadId, hostName })),
              wrap('prompt', () =>
                debugChatThreadPrompt({ threadId, hostName }),
              ),
              wrap('tools', () => debugChatThreadTools({ threadId, hostName })),
              wrap('workspace', () =>
                debugChatThreadWorkspace({ threadId, hostName }),
              ),
              wrap('sandbox', () =>
                debugChatThreadSandbox({ threadId, hostName }),
              ),
            ]

            Promise.all(tasks).then(() => {
              emit('done', { at: new Date().toISOString() })
              controller.close()
            })
          },
        })

        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          },
        })
      },
    },
  },
})
