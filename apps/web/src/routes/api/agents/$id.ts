import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  notFound,
  requireWorkspaceAccess,
  toAgent,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/agents/$id')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
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
          .set(updateValues)
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
