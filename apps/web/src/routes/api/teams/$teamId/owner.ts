import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest, json } from '@/lib/server/control-plane'
import { requireTeamOwnerTransfer } from '@/lib/server/team-access'
import { getTeamForViewer, transferTeamOwner } from '@/lib/server/teams'
import { parseJsonBody } from '@/lib/server/validation/common'
import { transferTeamOwnerBodySchema } from '@/lib/server/validation/teams'
import { publishWorkspaceEvent } from '@/lib/server/realtime'

export const Route = createFileRoute('/api/teams/$teamId/owner')({
  server: {
    handlers: {
      PUT: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamOwnerTransfer(appContext, params.teamId)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          transferTeamOwnerBodySchema,
          'Invalid Team owner payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const result = await transferTeamOwner({
          db: access.db,
          team: access.team,
          actorUserId: access.session.user.id,
          ownerUserId: bodyResult.value.owner_user_id,
        })
        if (result.isErr()) {
          return json(
            { error: result.error.message, code: result.error.code },
            result.error.status,
          )
        }

        const team = await getTeamForViewer({
          db: access.db,
          team: result.value,
          viewerId: access.session.user.id,
          viewerRole: access.workspaceMembership.role,
        })
        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, access.team.workspaceId, {
            type: 'team:updated',
            payload: {
              workspace_id: access.team.workspaceId,
              team_id: team.id,
              team,
            },
          }),
        )
        return json(team)
      },
    },
  },
})
