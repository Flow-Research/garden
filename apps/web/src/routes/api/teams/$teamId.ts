import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest, json } from '@/lib/server/control-plane'
import {
  requireTeamAccess,
  requireTeamManage,
  teamError,
} from '@/lib/server/team-access'
import {
  deleteTeam,
  getTeamForViewer,
  updateTeam,
} from '@/lib/server/teams'
import { parseJsonBody } from '@/lib/server/validation/common'
import { updateTeamBodySchema } from '@/lib/server/validation/teams'
import { publishWorkspaceEvent } from '@/lib/server/realtime'

export const Route = createFileRoute('/api/teams/$teamId')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamAccess(appContext, params.teamId)
        if (access instanceof Response) return access

        const team = await getTeamForViewer({
          db: access.db,
          team: access.team,
          viewerId: access.session.user.id,
          viewerRole: access.workspaceMembership.role,
        })
        return json(team)
      },
      PATCH: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          updateTeamBodySchema,
          'Invalid Team payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const result = await updateTeam({
          db: access.db,
          team: access.team,
          actorUserId: access.session.user.id,
          input: bodyResult.value,
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
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamAccess(appContext, params.teamId)
        if (access instanceof Response) return access
        if (!access.canTransferOwner) {
          return teamError(
            403,
            'TEAM_ACCESS_DENIED',
            'Only workspace owners and admins can delete a Team',
          )
        }

        const result = await deleteTeam({
          db: access.db,
          team: access.team,
          actorUserId: access.session.user.id,
        })
        if (result.isErr()) {
          return json(
            { error: result.error.message, code: result.error.code },
            result.error.status,
          )
        }
        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, access.team.workspaceId, {
            type: 'team:deleted',
            payload: {
              workspace_id: access.team.workspaceId,
              team_id: access.team.id,
              name: access.team.name,
            },
          }),
        )
        return new Response(null, { status: 204 })
      },
    },
  },
})
