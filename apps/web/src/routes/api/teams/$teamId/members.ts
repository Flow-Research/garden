import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest, json } from '@/lib/server/control-plane'
import {
  requireTeamAccess,
  requireTeamManage,
} from '@/lib/server/team-access'
import {
  addTeamMember,
  listTeamMembers,
  loadTeamMember,
} from '@/lib/server/teams'
import { parseJsonBody } from '@/lib/server/validation/common'
import { addTeamMemberBodySchema } from '@/lib/server/validation/teams'
import { publishWorkspaceEvent } from '@/lib/server/realtime'

export const Route = createFileRoute('/api/teams/$teamId/members')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamAccess(appContext, params.teamId)
        if (access instanceof Response) return access

        const members = await listTeamMembers({
          db: access.db,
          teamId: access.team.id,
        })
        return json({ members, total: members.length })
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          addTeamMemberBodySchema,
          'Invalid Team member payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const result = await addTeamMember({
          db: access.db,
          team: access.team,
          actorUserId: access.session.user.id,
          member: bodyResult.value,
        })
        if (result.isErr()) {
          return json(
            { error: result.error.message, code: result.error.code },
            result.error.status,
          )
        }

        const member = await loadTeamMember({
          db: access.db,
          teamId: access.team.id,
          membershipId: result.value.id,
        })
        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, access.team.workspaceId, {
            type: 'team_member:added',
            payload: {
              workspace_id: access.team.workspaceId,
              team_id: access.team.id,
              membership_id: result.value.id,
              member_type: result.value.userId ? 'user' : 'agent',
              user_id: result.value.userId,
              agent_id: result.value.agentId,
            },
          }),
        )
        return json(member ?? { id: result.value.id }, 201)
      },
    },
  },
})
