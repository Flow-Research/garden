import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { and, desc, eq } from 'drizzle-orm'
import { schema } from '@/lib/server/db'
import { getThreadAccess } from '@/lib/server/chat-threads'

/**
 * This thread's agent_proposal permission requests with their server status.
 *
 * The propose_agent approval card used to derive resolved/pending from the
 * embedded tool-output snapshot plus local optimistic state, which is wiped on
 * remount — so after a reconnect an already-approved card reappeared and could
 * be re-submitted (B2). The card now reads the durable permission_request status
 * instead (mind-map ProposalCard pattern).
 *
 * Scoped by `thread_id`, which propose-agent.ts records on insert (mirroring
 * issueId/runId). The default agent owns many threads, so this is the only way
 * to list a single thread's proposals without leaking the others.
 */
export const Route = createFileRoute(
  '/api/chat/threads/$id/permission-requests',
)({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const routeParams = params as { id: string }
        const access = await getThreadAccess(appContext, routeParams.id)
        if (access instanceof Response) return access

        const rows = await access.db
          .select({
            id: schema.permissionRequest.id,
            status: schema.permissionRequest.status,
            toolCallId: schema.permissionRequest.toolCallId,
            context: schema.permissionRequest.context,
          })
          .from(schema.permissionRequest)
          .where(
            and(
              eq(schema.permissionRequest.threadId, access.thread.id),
              eq(schema.permissionRequest.kind, 'agent_proposal'),
            ),
          )
          .orderBy(desc(schema.permissionRequest.requestedAt))

        const prefix = 'agent_proposal:'
        return Response.json({
          ok: true,
          requests: rows.map((row) => ({
            id: row.id,
            status: row.status,
            tool_call_id: row.toolCallId,
            pending_agent_id: row.context?.startsWith(prefix)
              ? row.context.slice(prefix.length)
              : null,
          })),
        })
      },
    },
  },
})
