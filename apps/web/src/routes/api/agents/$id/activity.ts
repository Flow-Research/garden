import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  json,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { getAgentActivityFeed } from '@/lib/server/agents/activity-service'

/**
 * Agent activity feed. Session + workspace resolve stay here; feed assembly
 * lives in activity-service / queries/agents.
 */
export const Route = createFileRoute('/api/agents/$id/activity')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const result = await getAgentActivityFeed({
          db: await appContext.db(),
          workspaceId,
          agentId: params.id,
        })
        return result.match({
          ok: (value) => Response.json(value),
          err: (error) =>
            error.status === 404
              ? notFound(error.message)
              : json({ error: error.message }, error.status),
        })
      },
    },
  },
})
