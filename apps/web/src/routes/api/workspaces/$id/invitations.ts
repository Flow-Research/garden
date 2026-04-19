import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import { appEnv } from '@/lib/server/env'
import {
  requireSession,
  toInvitation,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/workspaces/$id/invitations')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const auth = createAuth(appEnv)
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
