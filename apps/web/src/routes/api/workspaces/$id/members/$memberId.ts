import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  parseJsonBody,
  updateWorkspaceMemberBodySchema,
} from '@/lib/server/validation/workspaces'

export const Route = createFileRoute('/api/workspaces/$id/members/$memberId')({
  server: {
    handlers: {
      PATCH: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const bodyResult = await parseJsonBody(
          request,
          updateWorkspaceMemberBodySchema,
          'Invalid member payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const auth = await appContext.auth.getAuth()
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
      DELETE: async ({ context, request, params }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const auth = await appContext.auth.getAuth()
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
