import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import { appEnv } from '@/lib/server/env'
import { requireSession, unauthorized } from '@/lib/server/control-plane'

export const Route = createFileRoute(
  '/api/workspaces/$id/invitations/$invitationId',
)({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const auth = createAuth(appEnv, request)
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
