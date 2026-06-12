import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { Result, TaggedError } from 'better-result'
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
        })) as AuthInvitation
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
          return Response.json(
            { error: emailResult.error.message },
            { status: emailResult.error.status },
          )
        }

        return Response.json(toInvitation(invitation))
      },
    },
  },
})
