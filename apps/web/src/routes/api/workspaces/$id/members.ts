import { and, eq, sql } from 'drizzle-orm'
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
} from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import { sendOrganizationInvitationEmail } from '@/lib/server/email/invitation'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { githubIdentityByMemberId } from '@/lib/server/workspace-members'
import {
  attachInvitationTeams,
  cancelCreatedInvitation,
  createTeamOwnerInvitation,
  INVITATION_EXPIRES_IN_MS,
  InvitationTeamError,
  planInvitationTeams,
} from '@/lib/server/invitation-teams'

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
  createdAt?: Date | null
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
        const db = await appContext.db()
        const githubById = await githubIdentityByMemberId({
          db,
          workspaceId: params.id,
          memberIds: result.members.map((row) => row.id),
        })

        return Response.json(
          result.members.map((row) => {
            const github = githubById.get(row.id)
            return {
              id: row.id,
              workspace_id: row.organizationId,
              user_id: row.userId,
              role: row.role,
              github_user_id: github?.githubUserId ?? null,
              github_login: github?.githubLogin ?? null,
              created_at: new Date(row.createdAt).toISOString(),
              name: row.user.name,
              email: row.user.email,
              avatar_url: row.user.image ?? null,
            }
          }),
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
          const db = await appContext.db()

          /**
           * Resend path: refresh the existing pending row in place. Better
           * Auth's own `resend` flag cannot be used here — its
           * findPendingInvitation filters out expired invites (adapter.mjs),
           * so resending an expired invite would silently create a duplicate
           * row and orphan the original. Garden owns the mutation instead:
           * same effect as Better Auth's resend (extends expiresAt by the
           * default 48h window), but covering expired rows too.
           */
          if (body.resend) {
            const permissionResponse = await requireWorkspacePermission({
              appContext,
              request,
              workspaceId: params.id,
              permissions: workspacePermissions.invitationManage,
            })
            if (permissionResponse) {
              return Result.err(
                new WorkspaceInvitationRequestError({
                  message: 'You cannot manage invitations in this workspace',
                  status: permissionResponse.status,
                }),
              )
            }

            const [existing] = await db
              .select()
              .from(schema.invitation)
              .where(
                and(
                  eq(schema.invitation.organizationId, params.id),
                  sql`lower(${schema.invitation.email}) = lower(${body.email})`,
                  eq(schema.invitation.status, 'pending'),
                ),
              )
              .limit(1)

            if (!existing) {
              return Result.err(
                new WorkspaceInvitationRequestError({
                  message: 'Pending invitation not found',
                  status: 404,
                }),
              )
            }

            // A resend that names Teams adds them to the invite; one that
            // names none keeps the invite's current Teams.
            if (body.team_ids?.length) {
              const plan = yield* Result.await(
                planInvitationTeams({
                  db,
                  workspaceId: params.id,
                  inviterId: session.user.id,
                  role: existing.role,
                  requestedTeamIds: body.team_ids,
                }),
              )
              yield* Result.await(
                attachInvitationTeams({
                  db,
                  invitationId: existing.id,
                  workspaceId: params.id,
                  teamIds: plan.teamIds,
                }),
              )
            }

            const refreshedExpiry = new Date(
              Date.now() + INVITATION_EXPIRES_IN_MS,
            )
            const [updated] = await db
              .update(schema.invitation)
              .set({ expiresAt: refreshedExpiry })
              .where(
                and(
                  eq(schema.invitation.id, existing.id),
                  eq(schema.invitation.status, 'pending'),
                ),
              )
              .returning({ id: schema.invitation.id })

            if (!updated) {
              return Result.err(
                new WorkspaceInvitationRequestError({
                  message: 'Pending invitation not found',
                  status: 404,
                }),
              )
            }

            const refreshed = { ...existing, expiresAt: refreshedExpiry }
            const resendEmailResult = await sendInvitationForRoute({
              baseURL: new URL(request.url).origin,
              db,
              env: appContext.env,
              invitation: refreshed,
              inviter: {
                email: session.user.email,
                name: session.user.name,
              },
            })
            if (resendEmailResult.isErr()) {
              await db
                .update(schema.invitation)
                .set({ expiresAt: existing.expiresAt })
                .where(
                  and(
                    eq(schema.invitation.id, existing.id),
                    eq(schema.invitation.status, 'pending'),
                    eq(schema.invitation.expiresAt, refreshedExpiry),
                  ),
                )
              return Result.err(resendEmailResult.error)
            }

            return Result.ok(toInvitation(refreshed))
          }

          const role = body.role ?? 'member'
          const plan = yield* Result.await(
            planInvitationTeams({
              db,
              workspaceId: params.id,
              inviterId: session.user.id,
              role,
              requestedTeamIds: body.team_ids,
            }),
          )
          const invitation: AuthInvitation =
            plan.inviter === 'team_owner'
              ? yield* Result.await(
                  createTeamOwnerInvitation({
                    db,
                    workspaceId: params.id,
                    inviterId: session.user.id,
                    email: body.email,
                  }),
                )
              : yield* Result.await(
                  Result.tryPromise({
                    try: async () =>
                      (await auth.api.createInvitation({
                        headers: request.headers,
                        body: {
                          email: body.email,
                          role,
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

          // Cancel only invites this request created. The resend path
          // returned above before reaching here, so every invitation at this
          // point is newly created.
          const cancelCreated = async () => {
            const cancelResult = await cancelCreatedInvitation({
              db,
              invitationId: invitation.id,
            })
            if (cancelResult.isErr()) {
              logger.error('workspace.invitation_cancel_after_failure_failed', {
                invitationId: invitation.id,
                workspaceId: params.id,
                error:
                  cancelResult.error instanceof Error
                    ? cancelResult.error.message
                    : String(cancelResult.error),
              })
            }
          }

          const attachResult = await attachInvitationTeams({
            db,
            invitationId: invitation.id,
            workspaceId: params.id,
            teamIds: plan.teamIds,
          })
          if (attachResult.isErr()) {
            await cancelCreated()
            return Result.err(attachResult.error)
          }

          const emailResult = await sendInvitationForRoute({
            baseURL: new URL(request.url).origin,
            db,
            env: appContext.env,
            invitation,
            inviter: {
              email: session.user.email,
              name: session.user.name,
            },
          })
          if (emailResult.isErr()) {
            await cancelCreated()
            return Result.err(emailResult.error)
          }

          return Result.ok(toInvitation(invitation))
        })

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
