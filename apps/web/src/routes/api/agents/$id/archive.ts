import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  notFound,
  requireWorkspaceAccess,
  toAgent,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/agents/$id/archive')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [existingAgent] = await db
          .select({ workspaceId: schema.agent.workspaceId })
          .from(schema.agent)
          .where(eq(schema.agent.id, params.id))
        if (!existingAgent) return notFound('Agent not found')

        const access = await requireWorkspaceAccess(
          request,
          existingAgent.workspaceId,
        )
        if (access instanceof Response) return access

        const [agent] = await db
          .update(schema.agent)
          .set({ status: 'archived' })
          .where(
            and(
              eq(schema.agent.id, params.id),
              eq(schema.agent.workspaceId, existingAgent.workspaceId),
            ),
          )
          .returning()
        if (!agent) return notFound('Agent not found')
        return Response.json(toAgent(agent))
      },
    },
  },
})
