import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  requireWorkspaceAccess,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import {
  createTeam,
  listTeams,
} from '@/lib/server/teams'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { parseJsonBody } from '@/lib/server/validation/common'
import { createTeamBodySchema } from '@/lib/server/validation/teams'
import { publishWorkspaceEvent } from '@/lib/server/realtime'

export const Route = createFileRoute('/api/teams')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext, {
          missingWorkspaceResponse: () =>
            Response.json({ teams: [], total: 0, unique_member_count: 0 }),
        })
        if (workspaceContext instanceof Response) return workspaceContext

        const access = await requireWorkspaceAccess(
          appContext,
          workspaceContext.workspaceId,
        )
        if (access instanceof Response) return access

        const { teams, uniqueMemberCount } = await listTeams({
          db: await appContext.db(),
          workspaceId: access.membership.organizationId,
          viewerId: access.session.user.id,
          viewerRole: access.membership.role,
        })
        return json({
          teams,
          total: teams.length,
          unique_member_count: uniqueMemberCount,
        })
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext
        const { session, workspaceId } = workspaceContext

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId,
          permissions: workspacePermissions.teamManage,
        })
        if (permission) return permission

        const bodyResult = await parseJsonBody(
          request,
          createTeamBodySchema,
          'Invalid Team payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const result = await createTeam({
          db: await appContext.db(),
          workspaceId,
          actorUserId: session.user.id,
          input: bodyResult.value,
        })

        return result.match({
          ok: (team) => {
            appContext.waitUntil(
              publishWorkspaceEvent(appContext.env, workspaceId, {
                type: 'team:created',
                payload: {
                  workspace_id: workspaceId,
                  team_id: team.id,
                  team,
                },
              }),
            )
            return json(team, 201)
          },
          err: (error) => json({ error: error.message, code: error.code }, error.status),
        })
      },
    },
  },
})
