import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireSession, unauthorized } from '@/lib/server/control-plane'

export const Route = createFileRoute(
  '/api/workspaces/$id/invitations/$invitationId',
)({
  server: {
    handlers: {
      DELETE: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const auth = await appContext.auth.getAuth()
        await auth.api.cancelInvitation({
          headers: request.headers,
          body: {
            invitationId: params.invitationId,
          },
        })
        return new Response(null, { status: 204 })
      },
    },
  },
})
