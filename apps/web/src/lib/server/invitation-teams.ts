import { and, eq, inArray } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { isWorkspaceManagerRole } from '@garden/db/team-issue-visibility'
import { schema, type Db } from '@/lib/server/db'
import type { WorkspaceTeamSettings } from '@/lib/server/validation/workspaces'

export type InvitationTeamErrorCode =
  | 'TEAM_NOT_FOUND'
  | 'INVITATION_TEAM_FORBIDDEN'
  | 'INVITATION_TEAM_WRITE_FAILED'

export class InvitationTeamError extends TaggedError('InvitationTeamError')<{
  status: number
  code: InvitationTeamErrorCode
  message: string
  cause?: unknown
}>() {}

/** Mirrors Better Auth's `invitationExpiresIn` default (48h). */
export const INVITATION_EXPIRES_IN_MS = 48 * 3600 * 1000

function teamNotFound() {
  return new InvitationTeamError({
    status: 404,
    code: 'TEAM_NOT_FOUND',
    message: 'Team not found in this workspace',
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

/** Reads the typed invite settings off the workspace row. */
export async function readWorkspaceTeamSettings(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceTeamSettings | null> {
  const [row] = await db
    .select({ default_team_id: schema.organization.defaultTeamId })
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
  patch: WorkspaceTeamSettings
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
            .set({ defaultTeamId })
            .where(eq(schema.organization.id, args.workspaceId))
            .returning({ default_team_id: schema.organization.defaultTeamId }),
        catch: writeFailed,
      }),
    )
    if (!updated) return Result.err(teamNotFound())
    return Result.ok(updated satisfies WorkspaceTeamSettings)
  })
}

/**
 * Decides which Teams a new invite joins. Before this, an invite carried no
 * Teams, so accepted members landed on an empty board. Only workspace owners
 * and admins create invites, and they may attach any Team in the workspace.
 * With no Teams named, the workspace default applies. Unknown or
 * other-workspace Team ids return 404 before any invite exists. Team-owner
 * invites are a follow-up that will grant the permission through Better Auth
 * access control.
 */
export async function planInvitationTeams(args: {
  db: Db
  workspaceId: string
  inviterId: string
  requestedTeamIds: string[] | undefined
}): Promise<Result<string[], InvitationTeamError>> {
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
  if (!membership || !isWorkspaceManagerRole(membership.role)) {
    return Result.err(
      new InvitationTeamError({
        status: 403,
        code: 'INVITATION_TEAM_FORBIDDEN',
        message: 'Only workspace owners and admins can invite people',
      }),
    )
  }

  const teamIds = [...new Set(args.requestedTeamIds ?? [])]
  if (!teamIds.length) {
    return Result.ok(settings.default_team_id ? [settings.default_team_id] : [])
  }
  const teams = await args.db
    .select({ id: schema.team.id })
    .from(schema.team)
    .where(
      and(
        inArray(schema.team.id, teamIds),
        eq(schema.team.workspaceId, args.workspaceId),
      ),
    )
  return teams.length === teamIds.length
    ? Result.ok(teamIds)
    : Result.err(teamNotFound())
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
 * Drops an invite's Team rows after the route cancels it. Canceling keeps the
 * invitation row, so the `invitation_team` cascade does not fire.
 */
export async function discardInvitationTeams(args: {
  db: Db
  invitationId: string
}) {
  return Result.tryPromise({
    try: () =>
      args.db
        .delete(schema.invitationTeam)
        .where(eq(schema.invitationTeam.invitationId, args.invitationId)),
    catch: writeFailed,
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
