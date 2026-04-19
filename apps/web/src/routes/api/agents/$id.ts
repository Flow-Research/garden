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

export const Route = createFileRoute('/api/agents/$id')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        const updateValues: Partial<typeof schema.agent.$inferInsert> = {}
        if (typeof body?.name === 'string') updateValues.name = body.name
        if (typeof body?.description === 'string')
          updateValues.roleTitle = body.description
        if (
          body &&
          Object.prototype.hasOwnProperty.call(body, 'runtime_config')
        ) {
          updateValues.persona = JSON.stringify(body.runtime_config)
        }
        const db = getDb(appEnv)
        const [agent] = await db
          .update(schema.agent)
          .set(updateValues)
          .where(eq(schema.agent.id, params.id))
          .returning()
        if (!agent) return notFound('Agent not found')
        return Response.json(toAgent(agent))
      },
    },
  },
})
