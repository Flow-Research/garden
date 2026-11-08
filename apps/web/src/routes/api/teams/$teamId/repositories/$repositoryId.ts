import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { json } from '@/lib/server/control-plane'
import { teamRepositoryChangedEvent } from '@/lib/server/github-repo-import'
import { publishWorkspaceEvent } from '@/lib/server/realtime'
import { requireTeamManage } from '@/lib/server/team-access'
import { unlinkTeamRepository } from '@/lib/server/team-repositories'

/** Unlinks a repository. Imported issues stay on the Team board. */
export const Route = createFileRoute(
  '/api/teams/$teamId/repositories/$repositoryId',
)({
  server: {
    handlers: {
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const unlinked = await unlinkTeamRepository({
          db: access.db,
          team: access.team,
          teamRepositoryId: params.repositoryId,
        })
        if (unlinked.isErr()) {
          return json(
            { error: unlinked.error.message, code: unlinked.error.code },
            unlinked.error.status,
          )
        }
        appContext.waitUntil(
          publishWorkspaceEvent(
            appContext.env,
            access.team.workspaceId,
            teamRepositoryChangedEvent(access.team),
          ),
        )
        return new Response(null, { status: 204 })
      },
    },
  },
})
