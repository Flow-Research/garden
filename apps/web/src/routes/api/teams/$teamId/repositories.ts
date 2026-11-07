import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest, json } from '@/lib/server/control-plane'
import { teamRepositoryChangedEvent } from '@/lib/server/github-repo-import'
import { publishWorkspaceEvent } from '@/lib/server/realtime'
import { requireTeamAccess, requireTeamManage } from '@/lib/server/team-access'
import {
  linkTeamRepository,
  listTeamRepositories,
} from '@/lib/server/team-repositories'
import { parseJsonBody } from '@/lib/server/validation/common'
import { linkTeamRepositoryBodySchema } from '@/lib/server/validation/teams'

/**
 * GitHub repositories linked to a Team. Anyone who can see the Team can read
 * the list; linking needs Team management, the same rule as adding members.
 */
export const Route = createFileRoute('/api/teams/$teamId/repositories')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamAccess(appContext, params.teamId)
        if (access instanceof Response) return access

        const repositories = await listTeamRepositories(access.db, access.team)
        return json({ repositories })
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const body = await parseJsonBody(
          request,
          linkTeamRepositoryBodySchema,
          'Invalid repository link payload',
        )
        if (body.isErr()) return badRequest(body.error.message)

        const linked = await linkTeamRepository({
          db: access.db,
          env: appContext.env,
          team: access.team,
          githubRepoId: body.value.github_repo_id,
          linkedBy: access.session.user.id,
        })
        if (linked.isErr()) {
          return json(
            { error: linked.error.message, code: linked.error.code },
            linked.error.status,
          )
        }
        appContext.waitUntil(
          publishWorkspaceEvent(
            appContext.env,
            access.team.workspaceId,
            teamRepositoryChangedEvent(access.team),
          ),
        )
        return json(linked.value, 201)
      },
    },
  },
})
