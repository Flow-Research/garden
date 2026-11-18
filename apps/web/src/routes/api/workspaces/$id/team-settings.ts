import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest, notFound } from '@/lib/server/control-plane'
import {
  parseJsonBody,
  workspaceTeamSettingsSchema,
} from '@/lib/server/validation/workspaces'
import {
  readWorkspaceTeamSettings,
  updateWorkspaceTeamSettings,
} from '@/lib/server/invitation-teams'
import {
  requireWorkspaceMember,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

/**
 * Workspace invite settings for Teams: which Team an invite joins when it
 * names none. Any member can read them; only owners and admins can change
 * them.
 */
export const Route = createFileRoute('/api/workspaces/$id/team-settings')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireWorkspaceMember(appContext, params.id)
        if (access instanceof Response) return access

        const settings = await readWorkspaceTeamSettings(
          await appContext.db(),
          params.id,
        )
        return settings
          ? Response.json(settings)
          : notFound('Workspace not found')
      },
      PATCH: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireWorkspaceMember(
          appContext,
          params.id,
          workspacePermissions.teamManage,
        )
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          workspaceTeamSettingsSchema,
          'Invalid Team settings payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const result = await updateWorkspaceTeamSettings({
          db: await appContext.db(),
          workspaceId: params.id,
          patch: bodyResult.value,
        })
        return result.match({
          ok: (settings) => Response.json(settings),
          err: (error) =>
            Response.json(
              { error: error.message, code: error.code },
              { status: error.status },
            ),
        })
      },
    },
  },
})
