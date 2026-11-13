import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import type { MemberRole } from '@garden/core/types'
import { createLogger } from '@garden/observability/console'
import { toInvitation } from '@/lib/server/control-plane'
import type { Db } from '@/lib/server/db'
import { sendOrganizationInvitationEmail } from '@/lib/server/email/invitation'
import {
  attachInvitationTeams,
  discardInvitationTeams,
  INVITATION_EXPIRES_IN_MS,
  planInvitationTeams,
} from '@/lib/server/invitation-teams'
import type { InvitationTeamError } from '@/lib/server/invitation-teams'
import { getOrganizationName } from '@/lib/server/queries/issues/issue-rows'
import {
  findPendingInvitationByEmail,
  revertPendingInvitationExpiresAt,
  updatePendingInvitationExpiresAt,
} from '@/lib/server/queries/workspaces/invitations'
import { githubIdentityByMemberId } from '@/lib/server/queries/workspaces/members-github'

const logger = createLogger('workspace-members-service')

export class WorkspaceInvitationRequestError extends TaggedError(
  'WorkspaceInvitationRequestError',
)<{
  message: string
  status: number
}>() {}

export class WorkspaceInvitationEmailError extends TaggedError(
  'WorkspaceInvitationEmailError',
)<{
  message: string
  status: number
  cause?: unknown
}>() {}

export type AuthInvitation = {
  id: string
  organizationId: string
  inviterId: string
  email: string
  role?: string
  status: string
  createdAt?: Date | null
  expiresAt: Date
}

export type AuthMemberListRow = {
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
}

/**
 * Minimal Better Auth surface for invite/cancel. Method syntax (not property
 * function types) keeps parameter checks bivariant under strictFunctionTypes so
 * Garden's `MemberRole` body is assignable to Better Auth's
 * `OrganizationInvitationRole` without casting the real `auth` instance.
 */
type InvitationAuth = {
  api: {
    createInvitation(args: {
      headers: Headers
      body: {
        email: string
        role: MemberRole
        organizationId: string
      }
    }): Promise<unknown>
    cancelInvitation(args: {
      headers: Headers
      body: { invitationId: string }
    }): Promise<unknown>
  }
}

/**
 * Maps Better Auth listMembers rows to the public member DTO with github_*.
 * Used by `GET /api/workspaces/$id/members`.
 */
export async function listMembersWithGithub(
  db: Db,
  input: { workspaceId: string; members: AuthMemberListRow[] },
) {
  const githubById = await githubIdentityByMemberId({
    db,
    workspaceId: input.workspaceId,
    memberIds: input.members.map((row) => row.id),
  })

  return input.members.map((row) => {
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
  })
}

/**
 * Sends the invite email. Before: Better Auth background hook swallowed Resend
 * failures. After: the members service owns delivery so the API can fail
 * visibly; callers cancel a just-created invite on error.
 */
async function sendInvitationEmail(args: {
  baseURL: string
  db: Db
  env: Parameters<typeof sendOrganizationInvitationEmail>[0]['env']
  invitation: AuthInvitation
  inviter: { email: string; name?: string | null }
}) {
  const organizationName = await getOrganizationName(
    args.db,
    args.invitation.organizationId,
  )

  if (!organizationName) {
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
          organization: { name: organizationName },
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

export type InviteMemberInput = {
  auth: InvitationAuth
  baseURL: string
  db: Db
  email: string
  env: Parameters<typeof sendOrganizationInvitationEmail>[0]['env']
  headers: Headers
  inviter: { id: string; email: string; name?: string | null }
  role?: MemberRole
  teamIds?: string[]
  workspaceId: string
}

/**
 * Resends a pending invitation (including expired pending rows). Permission
 * must already be checked by the route. Preserves expiresAt rollback on email
 * failure and optional Team attach when team_ids are named.
 */
export async function resendPendingInvitation(
  input: InviteMemberInput,
): Promise<
  ResultValue<
    ReturnType<typeof toInvitation>,
    | WorkspaceInvitationRequestError
    | WorkspaceInvitationEmailError
    | InvitationTeamError
  >
> {
  return Result.gen(async function* () {
    const existing = await findPendingInvitationByEmail(input.db, {
      workspaceId: input.workspaceId,
      email: input.email,
    })

    if (!existing) {
      return Result.err(
        new WorkspaceInvitationRequestError({
          message: 'Pending invitation not found',
          status: 404,
        }),
      )
    }

    if (input.teamIds?.length) {
      const teamIds = yield* Result.await(
        planInvitationTeams({
          db: input.db,
          workspaceId: input.workspaceId,
          inviterId: input.inviter.id,
          requestedTeamIds: input.teamIds,
        }),
      )
      yield* Result.await(
        attachInvitationTeams({
          db: input.db,
          invitationId: existing.id,
          workspaceId: input.workspaceId,
          teamIds,
        }),
      )
    }

    const refreshedExpiry = new Date(Date.now() + INVITATION_EXPIRES_IN_MS)
    const updated = await updatePendingInvitationExpiresAt(input.db, {
      invitationId: existing.id,
      expiresAt: refreshedExpiry,
    })

    if (!updated) {
      return Result.err(
        new WorkspaceInvitationRequestError({
          message: 'Pending invitation not found',
          status: 404,
        }),
      )
    }

    const refreshed = { ...existing, expiresAt: refreshedExpiry }
    const resendEmailResult = await sendInvitationEmail({
      baseURL: input.baseURL,
      db: input.db,
      env: input.env,
      invitation: refreshed,
      inviter: {
        email: input.inviter.email,
        name: input.inviter.name,
      },
    })
    if (resendEmailResult.isErr()) {
      await revertPendingInvitationExpiresAt(input.db, {
        invitationId: existing.id,
        previousExpiresAt: existing.expiresAt,
        stampedExpiresAt: refreshedExpiry,
      })
      return Result.err(resendEmailResult.error)
    }

    return Result.ok(toInvitation(refreshed))
  })
}

/**
 * Creates a Better Auth invitation, attaches Teams, and sends email. On later
 * step failure, cancels the invite and discards Team rows.
 */
export async function createAndSendInvitation(
  input: InviteMemberInput,
): Promise<
  ResultValue<
    ReturnType<typeof toInvitation>,
    | WorkspaceInvitationRequestError
    | WorkspaceInvitationEmailError
    | InvitationTeamError
  >
> {
  return Result.gen(async function* () {
    const teamIds = yield* Result.await(
      planInvitationTeams({
        db: input.db,
        workspaceId: input.workspaceId,
        inviterId: input.inviter.id,
        requestedTeamIds: input.teamIds,
      }),
    )
    const invitation = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          (await input.auth.api.createInvitation({
            headers: input.headers,
            body: {
              email: input.email,
              role: input.role ?? 'member',
              organizationId: input.workspaceId,
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

    const cancelCreated = async () => {
      const cancelResult = await Result.tryPromise({
        try: async () => {
          await input.auth.api.cancelInvitation({
            headers: input.headers,
            body: { invitationId: invitation.id },
          })
        },
        catch: (cause) => cause,
      })
      if (cancelResult.isErr()) {
        logger.error('workspace.invitation_cancel_after_failure_failed', {
          invitationId: invitation.id,
          workspaceId: input.workspaceId,
          error:
            cancelResult.error instanceof Error
              ? cancelResult.error.message
              : String(cancelResult.error),
        })
      }
      const discardResult = await discardInvitationTeams({
        db: input.db,
        invitationId: invitation.id,
      })
      if (discardResult.isErr()) {
        logger.error('workspace.invitation_team_discard_failed', {
          invitationId: invitation.id,
          workspaceId: input.workspaceId,
          error: discardResult.error.message,
        })
      }
    }

    const attachResult = await attachInvitationTeams({
      db: input.db,
      invitationId: invitation.id,
      workspaceId: input.workspaceId,
      teamIds,
    })
    if (attachResult.isErr()) {
      await cancelCreated()
      return Result.err(attachResult.error)
    }

    const emailResult = await sendInvitationEmail({
      baseURL: input.baseURL,
      db: input.db,
      env: input.env,
      invitation,
      inviter: {
        email: input.inviter.email,
        name: input.inviter.name,
      },
    })
    if (emailResult.isErr()) {
      await cancelCreated()
      return Result.err(emailResult.error)
    }

    return Result.ok(toInvitation(invitation))
  })
}
