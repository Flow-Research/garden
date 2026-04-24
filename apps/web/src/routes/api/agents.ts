import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { createAgentBodySchema, parseJsonBody } from '@/lib/server/api-validation'
import {
  badRequest,
  notFound,
  requireSession,
  resolveWorkspaceId,
  toAgent,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json([])
        const db = getDb(appEnv)
        const rows = await db
          .select()
          .from(schema.agent)
          .where(eq(schema.agent.workspaceId, workspaceId))
        return Response.json(rows.map(toAgent))
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return notFound('Workspace not found')
        const bodyResult = await parseJsonBody(
          request,
          createAgentBodySchema,
          'Invalid agent payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const agentValues = {
          id: crypto.randomUUID(),
          workspaceId,
          ownerUserId: session.user.id,
          name: body.name,
          roleTitle:
            typeof body.description === 'string' ? body.description : null,
          persona:
            body.runtime_config && typeof body.runtime_config === 'object'
              ? JSON.stringify(body.runtime_config)
              : null,
          status: 'active',
        } as typeof schema.agent.$inferInsert
        const db = getDb(appEnv)
        const [agent] = await db
          .insert(schema.agent)
          .values(agentValues)
          .returning()
        return Response.json(toAgent(agent), { status: 201 })
      },
    },
  },
})
