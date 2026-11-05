import { createFileRoute } from '@tanstack/react-router'
import { TeamAgentPolicySchema } from '@garden/core/teams/agent-policy'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  isWorkspaceManager,
  requireTeamManage,
  teamError,
} from '@/lib/server/team-access'
import {
  readTeamAgentPolicy,
  writeTeamAgentPolicy,
} from '@/lib/server/team-agent-policy'
import { parseJsonBody } from '@/lib/server/validation/common'
import { publishWorkspaceEvent } from '@/lib/server/realtime'

/**
 * Team agent policy. Workspace managers and the Team owner read it; only
 * workspace managers replace it, because the Team owner is the person whose
 * approvals it shapes. See docs/concepts/features/teams.md.
 */
export const Route = createFileRoute('/api/teams/$teamId/agent-policy')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const result = await readTeamAgentPolicy({
          db: access.db,
          teamId: access.team.id,
          canEdit: isWorkspaceManager(access.workspaceMembership.role),
        })
        return result.match({
          ok: (policy) => Response.json(policy),
          err: (error) =>
            teamError(500, 'TEAM_OPERATION_FAILED', error.message),
        })
      },
      PUT: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access
        if (!isWorkspaceManager(access.workspaceMembership.role)) {
          return teamError(
            403,
            'TEAM_ACCESS_DENIED',
            'Only workspace owners and admins can change Team agent policy',
          )
        }

        const bodyResult = await parseJsonBody(
          request,
          TeamAgentPolicySchema,
          'Invalid Team agent policy',
        )
        if (bodyResult.isErr()) {
          return teamError(
            400,
            'TEAM_AGENT_POLICY_INVALID',
            bodyResult.error.message,
          )
        }

        const result = await writeTeamAgentPolicy({
          db: access.db,
          teamId: access.team.id,
          workspaceId: access.team.workspaceId,
          actorUserId: access.session.user.id,
          policy: bodyResult.value,
        })
        if (result.isErr()) {
          return teamError(500, 'TEAM_OPERATION_FAILED', result.error.message)
        }

        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, access.team.workspaceId, {
            type: 'team:policy_updated',
            payload: {
              workspace_id: access.team.workspaceId,
              team_id: access.team.id,
            },
          }),
        )
        return Response.json(result.value)
      },
    },
  },
})
