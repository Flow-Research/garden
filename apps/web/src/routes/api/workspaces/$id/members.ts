import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import {
  requireSession,
  toInvitation,
  unauthorized,
} from '@/lib/server/control-plane'
import { appEnv } from '@/lib/server/env'

export const Route = createFileRoute('/api/workspaces/$id/members')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const auth = createAuth(appEnv)
        const result = (await auth.api.listMembers({
          headers: request.headers,
          query: {
            organizationId: params.id,
          },
        })) as {
          members: Array<{
            id: string
            organizationId: string
            userId: string
            role: string
            createdAt: Date
            user: {
              name: string
              email: string
              image?: string | null
            }
          }>
        }
        return Response.json(
          result.members.map((row) => ({
            id: row.id,
            workspace_id: row.organizationId,
            user_id: row.userId,
            role: row.role,
            created_at: row.createdAt
              ? new Date(row.createdAt).toISOString()
              : new Date().toISOString(),
            name: row.user.name,
            email: row.user.email,
            avatar_url: row.user.image ?? null,
          })),
        )
      },
      POST: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const body = (await request.json().catch(() => null)) as {
          email?: unknown
          role?: unknown
        } | null
        if (typeof body?.email !== 'string' || typeof body?.role !== 'string') {
          return Response.json(
            { error: 'Invalid invite payload' },
            { status: 400 },
          )
        }
        const auth = createAuth(appEnv)
        const invitation = (await auth.api.createInvitation({
          headers: request.headers,
          body: {
            email: body.email,
            role: body.role as 'owner' | 'admin' | 'member',
            organizationId: params.id,
          },
        })) as {
          id: string
          organizationId: string
          inviterId: string
          email: string
          role?: string
          status: string
          createdAt: Date
          expiresAt: Date
        }
        return Response.json(toInvitation(invitation))
      },
    },
  },
})
