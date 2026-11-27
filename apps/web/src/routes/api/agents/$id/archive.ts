import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { notFound } from '@/lib/server/control-plane'
import {
  requireWorkspaceMember,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  resolveAgentWorkspaceForStatus,
  updateAgentStatus,
} from '@/lib/server/agents/status-service'

/**
 * Archives an agent. Permission in the route; status write in status-service.
 */
export const Route = createFileRoute('/api/agents/$id/archive')({
  server: {
    handlers: {
      POST: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const existing = await resolveAgentWorkspaceForStatus(db, params.id)
        if (existing.isErr()) return notFound(existing.error.message)

        const access = await requireWorkspaceMember(
          appContext,
          existing.value.workspaceId,
          workspacePermissions.agentManage,
        )
        if (access instanceof Response) return access

        const result = await updateAgentStatus({
          db,
          agentId: params.id,
          workspaceId: existing.value.workspaceId,
          status: 'archived',
        })
        return result.match({
          ok: (agent) => Response.json(agent),
          err: (error) =>
            Response.json({ error: error.message }, { status: error.status }),
        })
      },
    },
  },
})
