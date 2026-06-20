import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { bindExistingCapabilitiesToAgent } from '@/lib/server/agent-bindings'
import {
  createAgentBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/agents'
import { schema } from '@/lib/server/db'
import {
  badRequest,
  requireWorkspaceContext,
  toAgent,
} from '@/lib/server/control-plane'
import { getPostHogClient } from '@/lib/posthog-server'

export const Route = createFileRoute('/api/agents')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext, {
          missingWorkspaceResponse: () => Response.json([]),
        })
        if (workspaceContext instanceof Response) return workspaceContext
        const { workspaceId } = workspaceContext
        const db = await appContext.db()
        const rows = await db
          .select()
          .from(schema.agent)
          .where(eq(schema.agent.workspaceId, workspaceId))
        return Response.json(rows.map(toAgent))
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext
        const { session, workspaceId } = workspaceContext

        const bodyResult = await parseJsonBody(
          request,
          createAgentBodySchema,
          'Invalid agent payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const agentId = crypto.randomUUID()
        const agentValues = {
          id: agentId,
          workspaceId,
          ownerUserId: session.user.id,
          name: body.name,
          roleTitle:
            typeof body.description === 'string' ? body.description : null,
          instructions:
            typeof body.instructions === 'string' ? body.instructions : null,
          persona:
            body.runtime_config && typeof body.runtime_config === 'object'
              ? JSON.stringify(body.runtime_config)
              : null,
          status: 'active',
          hostName: agentId,
          permissions: DEFAULT_AGENT_PERMISSIONS,
        } as typeof schema.agent.$inferInsert
        const db = await appContext.db()
        const [agent] = await db
          .insert(schema.agent)
          .values(agentValues)
          .returning()
        await bindExistingCapabilitiesToAgent({
          db,
          schema,
          agentId: agent.id,
          grantedBy: session.user.id,
        })
        const posthog = getPostHogClient()
        posthog.capture({
          distinctId: session.user.id,
          event: 'agent_created',
          properties: {
            agent_id: agent.id,
            agent_name: body.name,
          },
        })
        await posthog.flush()
        return Response.json(toAgent(agent), { status: 201 })
      },
    },
  },
})
