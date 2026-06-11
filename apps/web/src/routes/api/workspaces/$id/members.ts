import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  createWorkspaceMemberBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/workspaces'
import {
  requireSession,
  toInvitation,
  unauthorized,
  badRequest,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/workspaces/$id/members')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const auth = await appContext.auth.getAuth()
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
      POST: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const bodyResult = await parseJsonBody(
          request,
          createWorkspaceMemberBodySchema,
          'Invalid invite payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const auth = await appContext.auth.getAuth()
        const invitation = (await auth.api.createInvitation({
          headers: request.headers,
          body: {
            email: body.email,
            role: body.role ?? 'member',
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
