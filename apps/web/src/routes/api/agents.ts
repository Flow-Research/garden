import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
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
        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        if (typeof body?.name !== 'string')
          return badRequest('Invalid agent payload')
        const agentValues = {
          id: crypto.randomUUID(),
          workspaceId,
          ownerUserId: session.user.id,
          name: body.name,
          roleTitle:
            typeof body.description === 'string' ? body.description : null,
          instructions:
            typeof body.instructions === 'string' ? body.instructions : null,
          persona: body.runtime_config
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
