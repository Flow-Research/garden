import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { Result, TaggedError } from 'better-result'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import {
  parseJsonBody,
  updateWorkspaceMemberBodySchema,
} from '@/lib/server/validation/workspaces'

class WorkspaceMemberRoleUpdateError extends TaggedError(
  'WorkspaceMemberRoleUpdateError',
)<{
  message: string
  status: number
  cause?: unknown
}>() {}

type WorkspaceMemberRow = {
  id: string
  workspaceId: string
  userId: string
  role: string
  createdAt: Date | null
  name: string
  email: string
  avatarUrl: string | null
}

function toMemberResponse(member: WorkspaceMemberRow) {
  return {
    id: member.id,
    workspace_id: member.workspaceId,
    user_id: member.userId,
    role: member.role,
    created_at: (member.createdAt ?? new Date()).toISOString(),
    name: member.name,
    email: member.email,
    avatar_url: member.avatarUrl,
  }
}

function messageFromCause(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

/**
 * Reads the updated member from Garden's canonical workspace tables after Better
 * Auth has authorized and applied the role change. The old route re-listed
 * members through Better Auth after writing, which made a successful update look
 * like a failure when the list response was stale or shaped differently. Keeping
 * the post-write read scoped to organization id and member id returns the exact
 * row the settings UI needs while preserving Better Auth as the permission and
 * mutation boundary. References: Better Auth organization update-member-role
 * source in node_modules and the local member/user Drizzle schema.
 */
async function readWorkspaceMember(args: {
  db: Db
  workspaceId: string
  memberId: string
}) {
  const [member] = await args.db
    .select({
      id: schema.member.id,
      workspaceId: schema.member.organizationId,
      userId: schema.member.userId,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
      avatarUrl: schema.user.avatarUrl,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      and(
        eq(schema.member.id, args.memberId),
        eq(schema.member.organizationId, args.workspaceId),
      ),
    )
    .limit(1)

  return member ?? null
}

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
        const db = await appContext.db()

        const result = await Result.gen(async function* () {
          yield* Result.await(
            Result.tryPromise({
              try: async () => {
                await auth.api.updateMemberRole({
                  headers: request.headers,
                  body: {
                    memberId: params.memberId,
                    organizationId: params.id,
                    role: body.role,
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
          err: (error) =>
            Response.json({ error: error.message }, { status: error.status }),
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
