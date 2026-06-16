import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { Result, TaggedError } from 'better-result'
import { createLogger } from '@garden/observability/console'
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
import { schema, type Db } from '@/lib/server/db'
import { sendOrganizationInvitationEmail } from '@/lib/server/email/invitation'

const logger = createLogger('workspace-members-api')

class WorkspaceInvitationRequestError extends TaggedError(
  'WorkspaceInvitationRequestError',
)<{
  message: string
  status: number
}>() {}

class WorkspaceInvitationEmailError extends TaggedError(
  'WorkspaceInvitationEmailError',
)<{
  message: string
  status: number
  cause?: unknown
}>() {}

type AuthInvitation = {
  id: string
  organizationId: string
  inviterId: string
  email: string
  role?: string
  status: string
  createdAt: Date
  expiresAt: Date
}

/**
 * Sends the invite email inside the route boundary instead of Better Auth's
 * background hook. Before this, Better Auth swallowed Resend failures after
 * creating the invitation, so users saw success while no email arrived. Keeping
 * delivery here lets the API return a visible failure and logs stay app-owned.
 * The caller cancels the just-created Better Auth invite when this fails so the
 * admin does not get a hidden pending invitation after a failed send toast.
 * Reference: Better Auth organization invite route uses runInBackgroundOrAwait;
 * Resend failures need to affect this product action.
 */
async function sendInvitationForRoute(args: {
  baseURL: string
  db: Db
  env: Parameters<typeof sendOrganizationInvitationEmail>[0]['env']
  invitation: AuthInvitation
  inviter: { email: string; name?: string | null }
}) {
  const [organization] = await args.db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, args.invitation.organizationId))
    .limit(1)

  if (!organization) {
    return Result.err(
      new WorkspaceInvitationEmailError({
        message: 'Invitation organization not found',
        status: 500,
      }),
    )
  }

  return await Result.tryPromise({
    try: async () => {
      await sendOrganizationInvitationEmail({
        baseURL: args.baseURL,
        env: args.env,
        data: {
          id: args.invitation.id,
          role: args.invitation.role ?? 'member',
          email: args.invitation.email,
          organization,
          invitation: { expiresAt: args.invitation.expiresAt },
          inviter: { user: args.inviter },
        },
      })
    },
    catch: (cause) =>
      new WorkspaceInvitationEmailError({
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to send invitation email',
        status: 502,
        cause,
      }),
  })
}

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
            created_at: new Date(row.createdAt).toISOString(),
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
        const auth = await appContext.auth.getAuth()
        const result = await Result.gen(async function* () {
          const bodyResult = await parseJsonBody(
            request,
            createWorkspaceMemberBodySchema,
            'Invalid invite payload',
          )
          if (bodyResult.isErr()) {
            return Result.err(
              new WorkspaceInvitationRequestError({
                message: bodyResult.error.message,
                status: 400,
              }),
            )
          }
          const body = bodyResult.value
          const invitation = yield* Result.await(
            Result.tryPromise({
              try: async () =>
                (await auth.api.createInvitation({
                  headers: request.headers,
                  body: {
                    email: body.email,
                    role: body.role ?? 'member',
                    organizationId: params.id,
                  },
                })) as AuthInvitation,
              catch: (cause) =>
                new WorkspaceInvitationRequestError({
                  message:
                    cause instanceof Error
                      ? cause.message
                      : 'Failed to create invitation',
                  status: 400,
                }),
            }),
          )
          const emailResult = await sendInvitationForRoute({
            baseURL: new URL(request.url).origin,
            db: await appContext.db(),
            env: appContext.env,
            invitation,
            inviter: {
              email: session.user.email,
              name: session.user.name,
            },
          })

          if (emailResult.isErr()) {
            const cancelResult = await Result.tryPromise({
              try: async () => {
                await auth.api.cancelInvitation({
                  headers: request.headers,
                  body: { invitationId: invitation.id },
                })
              },
              catch: (cause) => cause,
            })
            if (cancelResult.isErr()) {
              logger.error(
                'workspace.invitation_cancel_after_email_failure_failed',
                {
                  invitationId: invitation.id,
                  workspaceId: params.id,
                  error:
                    cancelResult.error instanceof Error
                      ? cancelResult.error.message
                      : String(cancelResult.error),
                },
              )
            }

            return Result.err(emailResult.error)
          }

          return Result.ok(toInvitation(invitation))
        })

        return result.match({
          ok: (invitation) => Response.json(invitation),
          err: (error) =>
            error instanceof WorkspaceInvitationRequestError
              ? badRequest(error.message)
              : Response.json(
                  { error: error.message },
                  { status: error.status },
                ),
        })
      },
    },
  },
})
