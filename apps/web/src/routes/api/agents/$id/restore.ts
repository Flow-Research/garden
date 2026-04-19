import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  notFound,
  requireSession,
  toAgent,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/agents/$id/restore')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const db = getDb(appEnv)
        const [agent] = await db
          .update(schema.agent)
          .set({ status: 'active' })
          .where(eq(schema.agent.id, params.id))
          .returning()
        if (!agent) return notFound('Agent not found')
        return Response.json(toAgent(agent))
      },
    },
  },
})
