import { and, eq, inArray, sql } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { isWorkspaceManagerRole } from '@garden/db/team-issue-visibility'
import { schema, type Db } from '@/lib/server/db'
import type { WorkspaceTeamSettings } from '@/lib/server/validation/workspaces'

export type InvitationTeamErrorCode =
  | 'TEAM_NOT_FOUND'
  | 'INVITATION_TEAM_FORBIDDEN'
  | 'TEAM_OWNER_INVITES_DISABLED'
  | 'INVITATION_ALREADY_PENDING'
  | 'USER_ALREADY_MEMBER'
  | 'INVITATION_TEAM_WRITE_FAILED'

export class InvitationTeamError extends TaggedError('InvitationTeamError')<{
  status: number
  code: InvitationTeamErrorCode
  message: string
  cause?: unknown
}>() {}

/**
 * Who may create an invite decides how it is created. Workspace owners and
 * admins go through Better Auth's `createInvitation`, which needs the
 * `invitation:create` permission. A Team owner who is a plain workspace
 * member lacks that permission, so Garden writes their invite row itself.
 */
export type InvitationInviter = 'workspace_manager' | 'team_owner'

export type InvitationTeamPlan = {
  inviter: InvitationInviter
  teamIds: string[]
}

/** Mirrors Better Auth's `invitationExpiresIn` default (48h). */
export const INVITATION_EXPIRES_IN_MS = 48 * 3600 * 1000

function teamNotFound() {
  return new InvitationTeamError({
    status: 404,
    code: 'TEAM_NOT_FOUND',
    message: 'Team not found in this workspace',
  })
}

function forbidden(message: string) {
  return new InvitationTeamError({
    status: 403,
    code: 'INVITATION_TEAM_FORBIDDEN',
    message,
  })
}

function writeFailed(cause: unknown) {
  return new InvitationTeamError({
    status: 500,
    code: 'INVITATION_TEAM_WRITE_FAILED',
    message: 'Failed to save the invitation Teams',
    cause,
  })
}

/** Reads the two typed invite settings off the workspace row. */
export async function readWorkspaceTeamSettings(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceTeamSettings | null> {
  const [row] = await db
    .select({
      team_owners_can_invite: schema.organization.teamOwnersCanInvite,
      default_team_id: schema.organization.defaultTeamId,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, workspaceId))
    .limit(1)
  return row ?? null
}

/**
 * Updates the workspace invite settings. `default_team_id` has a plain FK to
 * `team.id` (see the schema note), so this checks the Team belongs to the
 * workspace before writing it. Callers enforce owner/admin permission.
 */
export async function updateWorkspaceTeamSettings(args: {
  db: Db
  workspaceId: string
  patch: Partial<WorkspaceTeamSettings>
}) {
  return Result.gen(async function* () {
    const defaultTeamId = args.patch.default_team_id
    if (defaultTeamId) {
      const [team] = await args.db
        .select({ id: schema.team.id })
        .from(schema.team)
        .where(
          and(
            eq(schema.team.id, defaultTeamId),
            eq(schema.team.workspaceId, args.workspaceId),
          ),
        )
        .limit(1)
      if (!team) return Result.err(teamNotFound())
    }

    const [updated] = yield* Result.await(
      Result.tryPromise({
        try: () =>
          args.db
            .update(schema.organization)
            .set({
              ...(args.patch.team_owners_can_invite === undefined
                ? {}
                : { teamOwnersCanInvite: args.patch.team_owners_can_invite }),
              ...(defaultTeamId === undefined ? {} : { defaultTeamId }),
            })
            .where(eq(schema.organization.id, args.workspaceId))
            .returning({
              team_owners_can_invite: schema.organization.teamOwnersCanInvite,
              default_team_id: schema.organization.defaultTeamId,
            }),
        catch: writeFailed,
      }),
    )
    if (!updated) return Result.err(teamNotFound())
    return Result.ok(updated satisfies WorkspaceTeamSettings)
  })
}

/**
 * Decides which Teams a new invite joins and which creation path it takes.
 * Before this, an invite carried no Teams, so accepted members landed on an
 * empty board. Rules: owners and admins may attach any Team in the workspace,
 * and with no Teams named the workspace default applies. A Team owner may
 * attach only Teams they own, only while `team_owners_can_invite` is on, and
 * only as a `member`. Anyone else is refused. Unknown or other-workspace Team
 * ids return 404 before any invite exists.
 */
export async function planInvitationTeams(args: {
  db: Db
  workspaceId: string
  inviterId: string
  role: string
  requestedTeamIds: string[] | undefined
}): Promise<Result<InvitationTeamPlan, InvitationTeamError>> {
  const settings = await readWorkspaceTeamSettings(args.db, args.workspaceId)
  if (!settings) return Result.err(teamNotFound())

  const [membership] = await args.db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, args.workspaceId),
        eq(schema.member.userId, args.inviterId),
      ),
    )
    .limit(1)
  if (!membership) {
    return Result.err(forbidden('You cannot invite people to this workspace'))
  }

  const teamIds = [...new Set(args.requestedTeamIds ?? [])]
  const teams = teamIds.length
    ? await args.db
        .select({ id: schema.team.id, ownerUserId: schema.team.ownerUserId })
        .from(schema.team)
        .where(
          and(
            inArray(schema.team.id, teamIds),
            eq(schema.team.workspaceId, args.workspaceId),
          ),
        )
    : []
  if (teams.length !== teamIds.length) return Result.err(teamNotFound())

  if (isWorkspaceManagerRole(membership.role)) {
    const resolved =
      teamIds.length || !settings.default_team_id
        ? teamIds
        : [settings.default_team_id]
    return Result.ok({
      inviter: 'workspace_manager',
      teamIds: resolved,
    })
  }

  if (!teams.length) {
    return Result.err(
      forbidden('Only workspace owners and admins can invite without a Team'),
    )
  }
  if (teams.some((team) => team.ownerUserId !== args.inviterId)) {
    return Result.err(forbidden('You can only invite people to Teams you own'))
  }
  if (!settings.team_owners_can_invite) {
    return Result.err(
      new InvitationTeamError({
        status: 403,
        code: 'TEAM_OWNER_INVITES_DISABLED',
        message: 'Team owners cannot invite people in this workspace',
      }),
    )
  }
  if (args.role !== 'member') {
    return Result.err(forbidden('Team owners can only invite members'))
  }
  return Result.ok({ inviter: 'team_owner', teamIds })
}

/**
 * Writes a Team owner's invite row directly. Better Auth's `createInvitation`
 * refuses callers without `invitation:create`, which plain members lack, so
 * this mirrors its checks for the cases that matter here: an existing member
 * or a live pending invite for the same email is refused, the email is stored
 * lowercased, and the invite expires after Better Auth's default 48h.
 * Reference: better-auth organization `createInvitation` in crud-invites.mjs.
 */
export async function createTeamOwnerInvitation(args: {
  db: Db
  workspaceId: string
  inviterId: string
  email: string
}) {
  const email = args.email.toLowerCase()
  const [existingMember] = await args.db
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      and(
        eq(schema.member.organizationId, args.workspaceId),
        sql`lower(${schema.user.email}) = ${email}`,
      ),
    )
    .limit(1)
  if (existingMember) {
    return Result.err(
      new InvitationTeamError({
        status: 400,
        code: 'USER_ALREADY_MEMBER',
        message: 'User is already a member of this workspace',
      }),
    )
  }

  const [pending] = await args.db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, args.workspaceId),
        sql`lower(${schema.invitation.email}) = ${email}`,
        eq(schema.invitation.status, 'pending'),
        sql`${schema.invitation.expiresAt} > now()`,
      ),
    )
    .limit(1)
  if (pending) {
    return Result.err(
      new InvitationTeamError({
        status: 400,
        code: 'INVITATION_ALREADY_PENDING',
        message: 'User is already invited to this workspace',
      }),
    )
  }

  const inserted = await Result.tryPromise({
    try: () =>
      args.db
        .insert(schema.invitation)
        .values({
          organizationId: args.workspaceId,
          inviterId: args.inviterId,
          email,
          role: 'member',
          status: 'pending',
          expiresAt: new Date(Date.now() + INVITATION_EXPIRES_IN_MS),
        })
        .returning(),
    catch: writeFailed,
  })
  return inserted.andThen(([row]) =>
    row
      ? Result.ok(row)
      : Result.err(writeFailed('no invitation row returned')),
  )
}

/** Records the Teams an invite joins. Re-attaching the same Team is a no-op. */
export async function attachInvitationTeams(args: {
  db: Db
  invitationId: string
  workspaceId: string
  teamIds: string[]
}) {
  if (!args.teamIds.length) return Result.ok(undefined)
  return (
    await Result.tryPromise({
      try: () =>
        args.db
          .insert(schema.invitationTeam)
          .values(
            args.teamIds.map((teamId) => ({
              invitationId: args.invitationId,
              teamId,
              workspaceId: args.workspaceId,
            })),
          )
          .onConflictDoNothing(),
      catch: writeFailed,
    })
  ).map(() => undefined)
}

/**
 * Cancels an invite this request just created after its email failed, and
 * drops its Team rows. Canceling keeps the invitation row, so the
 * `invitation_team` cascade does not fire and the rows are deleted here. The
 * status update matches only `pending` so a concurrent accept is never undone.
 * Both creation paths use this direct update: a Team owner lacks Better
 * Auth's `invitation:cancel` permission.
 */
export async function cancelCreatedInvitation(args: {
  db: Db
  invitationId: string
}) {
  return Result.tryPromise({
    try: async () => {
      await args.db
        .update(schema.invitation)
        .set({ status: 'canceled' })
        .where(
          and(
            eq(schema.invitation.id, args.invitationId),
            eq(schema.invitation.status, 'pending'),
          ),
        )
      await args.db
        .delete(schema.invitationTeam)
        .where(eq(schema.invitationTeam.invitationId, args.invitationId))
    },
    catch: (cause) => cause,
  })
}

/**
 * Adds an accepted invitee to every Team the invite carries. Runs after the
 * workspace membership exists, on the normal accept path and on the
 * membership-already-exists recovery path, so a repeat accept converges to
 * the same rows: `onConflictDoNothing` skips memberships that already exist.
 * `created_by` is the inviter, who chose the Teams.
 */
export async function joinInvitationTeams(args: {
  db: Db
  invitationId: string
  userId: string
}) {
  return Result.tryPromise({
    try: async () => {
      const rows = await args.db
        .select({
          teamId: schema.invitationTeam.teamId,
          workspaceId: schema.invitationTeam.workspaceId,
          inviterId: schema.invitation.inviterId,
        })
        .from(schema.invitationTeam)
        .innerJoin(
          schema.invitation,
          eq(schema.invitation.id, schema.invitationTeam.invitationId),
        )
        .where(eq(schema.invitationTeam.invitationId, args.invitationId))
      if (!rows.length) return 0
      const inserted = await args.db
        .insert(schema.teamMember)
        .values(
          rows.map((row) => ({
            teamId: row.teamId,
            workspaceId: row.workspaceId,
            userId: args.userId,
            createdBy: row.inviterId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.teamMember.id })
      return inserted.length
    },
    catch: writeFailed,
  })
}
