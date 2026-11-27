import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  json,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { getAgentAccessState } from '@/lib/server/agents/access-service'

/**
 * Agent access review. Session + workspace resolve stay here; capability /
 * grant assembly lives in access-service / queries/agents.
 */
export const Route = createFileRoute('/api/agents/$id/access')({
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

        const result = await getAgentAccessState({
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
