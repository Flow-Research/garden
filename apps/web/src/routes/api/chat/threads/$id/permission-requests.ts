import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { desc, eq } from 'drizzle-orm'
import { schema } from '@/lib/server/db'
import { getThreadAccess } from '@/lib/server/chat-threads'

/**
 * This thread's agent proposals with their server-authoritative status.
 *
 * The approval card previously trusted an embedded tool-output snapshot, then
 * read the mixed permission_request ledger after reconnect. It now reads the
 * dedicated Garden proposal ledger, scoped by thread to avoid leaking another
 * default-agent conversation while preserving the existing response shape.
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
            id: schema.agentProposalRequest.id,
            status: schema.agentProposalRequest.status,
            pendingAgentId: schema.agentProposalRequest.pendingAgentId,
          })
          .from(schema.agentProposalRequest)
          .where(eq(schema.agentProposalRequest.threadId, access.thread.id))
          .orderBy(desc(schema.agentProposalRequest.requestedAt))

        return Response.json({
          ok: true,
          requests: rows.map((row) => ({
            id: row.id,
            status: row.status,
            tool_call_id: row.id,
            pending_agent_id: row.pendingAgentId,
          })),
        })
      },
    },
  },
})
