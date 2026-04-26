import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  parseJsonBody,
  updateWorkspaceMemberBodySchema,
} from '@/lib/server/api-validation'

export const Route = createFileRoute('/api/workspaces/$id/members/$memberId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const bodyResult = await parseJsonBody(
          request,
          updateWorkspaceMemberBodySchema,
          'Invalid member payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const auth = createAuth(appEnv)
        await auth.api.updateMemberRole({
          headers: request.headers,
          body: {
            memberId: params.memberId,
            organizationId: params.id,
            role: body.role,
          },
        })
        const refreshed = await auth.api.listMembers({
          headers: request.headers,
          query: { organizationId: params.id },
        })
        const member = refreshed.members.find(
          (item) => item.id === params.memberId,
        )
        if (!member) {
          return Response.json({ error: 'Member not found' }, { status: 404 })
        }
        return Response.json({
          id: member.id,
          workspace_id: member.organizationId,
          user_id: member.userId,
          role: member.role,
          created_at: new Date(member.createdAt).toISOString(),
          name: member.user.name,
          email: member.user.email,
          avatar_url: member.user.image ?? null,
        })
      },
      DELETE: async ({ request, params }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const auth = createAuth(appEnv)
        await auth.api.removeMember({
          headers: request.headers,
          body: {
            memberIdOrEmail: params.memberId,
            organizationId: params.id,
          },
        })
        return new Response(null, { status: 204 })
      },
    },
  },
})
