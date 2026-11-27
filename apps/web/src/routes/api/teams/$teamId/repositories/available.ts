import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { json } from '@/lib/server/control-plane'
import { requireTeamManage } from '@/lib/server/team-access'
import { listAvailableTeamRepositories } from '@/lib/server/team-repositories'

/** Repositories the workspace's GitHub App can access, for the link picker. */
export const Route = createFileRoute(
  '/api/teams/$teamId/repositories/available',
)({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const available = await listAvailableTeamRepositories({
          db: access.db,
          env: appContext.env,
          team: access.team,
        })
        if (available.isErr()) {
          return json(
            { error: available.error.message, code: available.error.code },
            available.error.status,
          )
        }
        return json({ repositories: available.value })
      },
    },
  },
})
