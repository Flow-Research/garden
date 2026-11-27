import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  createWorkspaceMemberBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/workspaces'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { InvitationTeamError } from '@/lib/server/invitation-teams'
import {
  createAndSendInvitation,
  listMembersWithGithub,
  resendPendingInvitation,
  type AuthMemberListRow,
} from '@/lib/server/workspaces/members-service'

/**
 * `/api/workspaces/$id/members` list/invite. Auth + Zod + permission here;
 * github hydrate and invite/resend orchestration live in members-service /
 * queries/workspaces (no Drizzle in this route).
 */
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
        })) as { members: AuthMemberListRow[] }
        const db = await appContext.db()
        const members = await listMembersWithGithub(db, {
          workspaceId: params.id,
          members: result.members,
        })
        return Response.json(members)
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
        const db = await appContext.db()
        const auth = await appContext.auth.getAuth()

        const inviteInput = {
          auth,
          baseURL: new URL(request.url).origin,
          db,
          email: body.email,
          env: appContext.env,
          headers: request.headers,
          inviter: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
          },
          role: body.role,
          teamIds: body.team_ids,
          workspaceId: params.id,
        }

        /**
         * Resend path: permission first, then refresh the pending row in place
         * (including expired pending). Better Auth's `resend` flag cannot cover
         * expired invites — see members-service JSDoc.
         */
        if (body.resend) {
          const permissionResponse = await requireWorkspacePermission({
            appContext,
            request,
            workspaceId: params.id,
            permissions: workspacePermissions.invitationManage,
          })
          if (permissionResponse) {
            return Response.json(
              { error: 'You cannot manage invitations in this workspace' },
              { status: permissionResponse.status },
            )
          }

          const result = await resendPendingInvitation(inviteInput)
          return result.match({
            ok: (invitation) => Response.json(invitation),
            err: (error) =>
              Response.json(
                error instanceof InvitationTeamError
                  ? { error: error.message, code: error.code }
                  : { error: error.message },
                { status: error.status },
              ),
          })
        }

        const result = await createAndSendInvitation(inviteInput)
        return result.match({
          ok: (invitation) => Response.json(invitation),
          err: (error) =>
            Response.json(
              error instanceof InvitationTeamError
                ? { error: error.message, code: error.code }
                : { error: error.message },
              { status: error.status },
            ),
        })
      },
    },
  },
})
