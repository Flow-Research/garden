import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  requireSession,
  toInvitation,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/workspaces/$id/invitations')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const auth = await appContext.auth.getAuth()
        const rows = (await auth.api.listInvitations({
          headers: request.headers,
          query: {
            organizationId: params.id,
          },
        })) as Array<{
          id: string
          organizationId: string
          inviterId: string
          email: string
          role?: string
          status: string
          createdAt: Date
          expiresAt: Date
        }>
        return Response.json(rows.map((row) => toInvitation(row)))
      },
    },
  },
})
