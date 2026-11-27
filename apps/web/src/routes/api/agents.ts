import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  createAgentBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/agents'
import { badRequest, requireWorkspaceContext } from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { createWorkspaceAgent } from '@/lib/server/agents/create-service'
import { listWorkspaceAgents } from '@/lib/server/agents/list-service'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'

/**
 * `/api/agents` list/create. Auth + Zod + permission here; SQL and grant
 * seeding live in agents services / queries (no Drizzle in this route).
 * See `docs/decisions/2026-11-09-api-layering.md`.
 */
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
        const agents = await listWorkspaceAgents(db, workspaceId)
        return Response.json(agents)
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext
        const { session, workspaceId } = workspaceContext
        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId,
          permissions: workspacePermissions.agentManage,
        })
        if (permission) return permission

        const bodyResult = await parseJsonBody(
          request,
          createAgentBodySchema,
          'Invalid agent payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const createResult = await createWorkspaceAgent({
          db: await appContext.db(),
          workspaceId,
          ownerUserId: session.user.id,
          name: body.name,
          description: body.description,
          instructions: body.instructions,
          runtimeConfig: body.runtime_config,
        })
        if (createResult.isErr()) {
          return Response.json(
            { error: createResult.error.message },
            { status: createResult.error.status },
          )
        }

        capturePostHogEvent(appContext, {
          distinctId: session.user.id,
          event: GARDEN_ANALYTICS_EVENTS.agentCreated,
          workspaceId,
          properties: {
            agent_id: createResult.value.id,
            agent_name: body.name,
          },
        })
        return Response.json(createResult.value, { status: 201 })
      },
    },
  },
})
