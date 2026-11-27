import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest, forbidden } from '@/lib/server/control-plane'
import {
  notificationPreferenceUpdateSchema,
  parseJsonBody,
} from '@/lib/server/validation/workspaces'
import {
  readMemberNotificationPreferences,
  updateMemberNotificationPreference,
} from '@/lib/server/queries/workspaces/notification-preferences'
import { requireWorkspaceMember } from '@/lib/server/workspace-permissions'

/**
 * The caller's own notification preferences in one workspace. The member is
 * always the session user, so no request field can address another member.
 */
export const Route = createFileRoute(
  '/api/workspaces/$id/notification-preferences',
)({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireWorkspaceMember(appContext, params.id)
        if (access instanceof Response) return access

        const preferences = await readMemberNotificationPreferences({
          db: await appContext.db(),
          workspaceId: params.id,
          userId: access.session.user.id,
        })
        return preferences
          ? Response.json({ preferences })
          : forbidden('Workspace access denied')
      },
      PATCH: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireWorkspaceMember(appContext, params.id)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          notificationPreferenceUpdateSchema,
          'Invalid notification preference',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const preferences = await updateMemberNotificationPreference({
          db: await appContext.db(),
          workspaceId: params.id,
          userId: access.session.user.id,
          update: bodyResult.value,
        })
        return preferences
          ? Response.json({ preferences })
          : forbidden('Workspace access denied')
      },
    },
  },
})
