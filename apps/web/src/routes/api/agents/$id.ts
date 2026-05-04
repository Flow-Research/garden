import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  parseJsonBody,
  updateAgentBodySchema,
} from '@/lib/server/validation/agents'
import { refreshChatThreadPromptConfig } from '@/lib/server/chat-agents'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
  toAgent,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/agents/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [agent] = await db
          .select()
          .from(schema.agent)
          .where(eq(schema.agent.id, params.id))
        if (!agent) return notFound('Agent not found')

        const access = await requireWorkspaceAccess(request, agent.workspaceId)
        if (access instanceof Response) return access

        return Response.json(toAgent(agent))
      },
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
        if (typeof body.description === 'string') {
          updateValues.roleTitle = body.description
        }
        if (typeof body.instructions === 'string') {
          updateValues.instructions = body.instructions
        }
        if (Object.prototype.hasOwnProperty.call(body, 'runtime_config')) {
          updateValues.persona =
            body.runtime_config && typeof body.runtime_config === 'object'
              ? JSON.stringify(body.runtime_config)
              : null
        }

        const db = getDb(appEnv)
        const [existingAgent] = await db
          .select({
            workspaceId: schema.agent.workspaceId,
            hostName: schema.agent.id,
          })
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

        if (existingAgent.hostName) {
          const hostName = existingAgent.hostName
          const threads = await db
            .select({
              id: schema.chatThread.id,
            })
            .from(schema.chatThread)
            .where(eq(schema.chatThread.agentId, params.id))

          await Promise.all(
            threads.map((thread) =>
              refreshChatThreadPromptConfig({
                threadId: thread.id,
                hostName,
              }),
            ),
          )
        }

        return Response.json(toAgent(agent))
      },
    },
  },
})
