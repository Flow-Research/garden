import { createFileRoute } from '@tanstack/react-router'
import { Result, TaggedError } from 'better-result'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  forbidden,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import {
  parseJsonBody,
  updateWorkspaceMemberBodySchema,
} from '@/lib/server/validation/workspaces'
import {
  canEditMemberGithubIdentity,
  linkOrRefreshMemberGithubIdentity,
  readWorkspaceMember,
  toMemberResponse,
  WorkspaceMemberGithubError,
} from '@/lib/server/workspace-members'

class WorkspaceMemberRoleUpdateError extends TaggedError(
  'WorkspaceMemberRoleUpdateError',
)<{
  message: string
  status: number
  cause?: unknown
}>() {}

function messageFromCause(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

export const Route = createFileRoute('/api/workspaces/$id/members/$memberId')({
  server: {
    handlers: {
      /**
       * Updates member role (Better Auth) and/or GitHub identity (Garden member
       * row). Role changes keep Better Auth as the permission boundary. GitHub
       * link/unlink is self-serve for the target member, or admin/owner for
       * anyone else — without requiring invitationManage-style org perms.
       */
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
        const db = await appContext.db()

        const result = await Result.gen(async function* () {
          const existing = yield* Result.await(
            Result.tryPromise({
              try: async () =>
                await readWorkspaceMember({
                  db,
                  workspaceId: params.id,
                  memberId: params.memberId,
                }),
              catch: (cause) =>
                new WorkspaceMemberRoleUpdateError({
                  message: messageFromCause(cause, 'Failed to read member'),
                  status: 500,
                  cause,
                }),
            }),
          )

          if (!existing) {
            return Result.err(
              new WorkspaceMemberRoleUpdateError({
                message: 'Member not found',
                status: 404,
              }),
            )
          }

          // GitHub identity before role: schema rejects combined bodies, and
          // this order still avoids a role write when identity auth fails.
          if (
            body.github_user_id !== undefined &&
            body.github_login !== undefined
          ) {
            const allowed = yield* Result.await(
              Result.tryPromise({
                try: async () =>
                  await canEditMemberGithubIdentity({
                    db,
                    workspaceId: params.id,
                    actorUserId: session.user.id,
                    targetUserId: existing.userId,
                  }),
                catch: (cause) =>
                  new WorkspaceMemberGithubError({
                    message: messageFromCause(
                      cause,
                      'Failed to check GitHub identity permission',
                    ),
                    status: 500,
                    cause,
                  }),
              }),
            )
            if (!allowed) {
              return Result.err(
                new WorkspaceMemberGithubError({
                  message:
                    'Only the member or a workspace owner/admin can update GitHub identity',
                  status: 403,
                }),
              )
            }

            yield* Result.await(
              linkOrRefreshMemberGithubIdentity({
                db,
                workspaceId: params.id,
                memberId: params.memberId,
                existingGithubUserId: existing.githubUserId,
                githubUserId: body.github_user_id,
                githubLogin: body.github_login,
              }),
            )
          }

          const nextRole = body.role
          if (nextRole !== undefined) {
            yield* Result.await(
              Result.tryPromise({
                try: async () => {
                  await auth.api.updateMemberRole({
                    headers: request.headers,
                    body: {
                      memberId: params.memberId,
                      organizationId: params.id,
                      role: nextRole,
                    },
                  })
                },
                catch: (cause) =>
                  new WorkspaceMemberRoleUpdateError({
                    message: messageFromCause(
                      cause,
                      'Failed to update member role',
                    ),
                    status: 400,
                    cause,
                  }),
              }),
            )
          }

          const member = yield* Result.await(
            Result.tryPromise({
              try: async () =>
                await readWorkspaceMember({
                  db,
                  workspaceId: params.id,
                  memberId: params.memberId,
                }),
              catch: (cause) =>
                new WorkspaceMemberRoleUpdateError({
                  message: messageFromCause(
                    cause,
                    'Failed to read updated member',
                  ),
                  status: 500,
                  cause,
                }),
            }),
          )

          if (!member) {
            return Result.err(
              new WorkspaceMemberRoleUpdateError({
                message: 'Member not found',
                status: 404,
              }),
            )
          }

          return Result.ok(toMemberResponse(member))
        })

        return result.match({
          ok: (member) => Response.json(member),
          err: (error) => {
            if (
              error instanceof WorkspaceMemberGithubError &&
              error.status === 403
            ) {
              return forbidden(error.message)
            }
            return Response.json(
              { error: error.message },
              { status: error.status },
            )
          },
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
