import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { json } from '@/lib/server/control-plane'
import { teamRepositoryChangedEvent } from '@/lib/server/github-repo-import'
import { publishWorkspaceEvent } from '@/lib/server/realtime'
import { requireTeamManage } from '@/lib/server/team-access'
import { retryTeamRepositoryImport } from '@/lib/server/team-repositories'

/** Runs a failed repository import again. */
export const Route = createFileRoute(
  '/api/teams/$teamId/repositories/$repositoryId/retry',
)({
  server: {
    handlers: {
      POST: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const retried = await retryTeamRepositoryImport({
          db: access.db,
          env: appContext.env,
          team: access.team,
          teamRepositoryId: params.repositoryId,
        })
        if (retried.isErr()) {
          return json(
            { error: retried.error.message, code: retried.error.code },
            retried.error.status,
          )
        }
        appContext.waitUntil(
          publishWorkspaceEvent(
            appContext.env,
            access.team.workspaceId,
            teamRepositoryChangedEvent(access.team),
          ),
        )
        return json(retried.value)
      },
    },
  },
})
