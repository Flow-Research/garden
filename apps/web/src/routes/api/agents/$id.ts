import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  updateAgentBodySchema,
} from '@/lib/server/validation/agents'
import { refreshChatThreadPromptConfig } from '@/lib/server/chat-agents'
import { schema } from '@/lib/server/db'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
  toAgent,
} from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

export const Route = createFileRoute('/api/agents/$id')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [agent] = await db
          .select()
          .from(schema.agent)
          .where(eq(schema.agent.id, params.id))
        if (!agent) return notFound('Agent not found')

        const access = await requireWorkspaceAccess(
          appContext,
          agent.workspaceId,
        )
        if (access instanceof Response) return access

        return Response.json(toAgent(agent))
      },
      PUT: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
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

        const db = await appContext.db()
        const [existingAgent] = await db
          .select({
            workspaceId: schema.agent.workspaceId,
            hostName: schema.agent.hostName,
          })
          .from(schema.agent)
          .where(eq(schema.agent.id, params.id))
        if (!existingAgent) return notFound('Agent not found')

        const access = await requireWorkspaceAccess(
          request,
          existingAgent.workspaceId,
        )
        if (access instanceof Response) return access
        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId: existingAgent.workspaceId,
          permissions: workspacePermissions.agentManage,
        })
        if (permission) return permission
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
