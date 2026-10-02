import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { json } from '@/lib/server/control-plane'
import { requireTeamManage } from '@/lib/server/team-access'
import { removeTeamMember } from '@/lib/server/teams'

export const Route = createFileRoute('/api/teams/$teamId/members/$membershipId')({
  server: {
    handlers: {
      DELETE: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireTeamManage(appContext, params.teamId)
        if (access instanceof Response) return access

        const result = await removeTeamMember({
          db: access.db,
          team: access.team,
          actorUserId: access.session.user.id,
          membershipId: params.membershipId,
        })
        if (result.isErr()) {
          return json(
            { error: result.error.message, code: result.error.code },
            result.error.status,
          )
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
