import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  updateAgentBodySchema,
} from '@/lib/server/validation/agents'
import { refreshChatThreadPromptConfig } from '@/lib/server/chat-agents'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import {
  requireWorkspaceMember,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { getAgentRecord } from '@/lib/server/agents/get-service'
import { updateWorkspaceAgent } from '@/lib/server/agents/update-service'
import { getAgentWorkspaceHost } from '@/lib/server/queries/agents'

/**
 * `/api/agents/$id` get/update. Auth + Zod here; row writes in agents
 * services / queries. Prompt refresh stays a post-success route side effect.
 */
export const Route = createFileRoute('/api/agents/$id')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const result = await getAgentRecord(db, params.id)
        if (result.isErr()) {
          return notFound(result.error.message)
        }

        const access = await requireWorkspaceAccess(
          appContext,
          result.value.workspaceId,
        )
        if (access instanceof Response) return access

        return Response.json(result.value.agent)
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

        const db = await appContext.db()
        const existingAgent = await getAgentWorkspaceHost(db, params.id)
        if (!existingAgent) return notFound('Agent not found')

        const access = await requireWorkspaceMember(
          appContext,
          existingAgent.workspaceId,
          workspacePermissions.agentManage,
        )
        if (access instanceof Response) return access

        const updateResult = await updateWorkspaceAgent({
          db,
          agentId: params.id,
          workspaceId: existingAgent.workspaceId,
          hostName: existingAgent.hostName,
          body,
        })
        if (updateResult.isErr()) {
          return Response.json(
            { error: updateResult.error.message },
            { status: updateResult.error.status },
          )
        }

        const { agent, hostName, threadIds } = updateResult.value
        if (hostName) {
          await Promise.all(
            threadIds.map((threadId) =>
              refreshChatThreadPromptConfig({
                threadId,
                hostName,
              }),
            ),
          )
        }

        return Response.json(agent)
      },
    },
  },
})
