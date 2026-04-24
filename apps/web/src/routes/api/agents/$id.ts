import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { badRequest, notFound, requireWorkspaceAccess, toAgent } from '@/lib/server/control-plane'
import { parseJsonBody, updateAgentBodySchema } from '@/lib/server/api-validation'

export const Route = createFileRoute('/api/agents/$id')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const bodyResult = await parseJsonBody(
          request,
          updateAgentBodySchema,
          'Invalid agent payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const updateValues: Partial<typeof schema.agent.$inferInsert> = {}
        if (typeof body.name === 'string') updateValues.name = body.name
        if (typeof body.description === 'string')
          updateValues.roleTitle = body.description
        if (Object.prototype.hasOwnProperty.call(body, 'runtime_config')) {
          updateValues.persona =
            body.runtime_config && typeof body.runtime_config === 'object'
              ? JSON.stringify(body.runtime_config)
              : null
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
        if (Object.keys(updateValues).length === 0) {
          return badRequest('No valid agent changes submitted')
        }

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
