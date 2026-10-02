import { and, eq } from 'drizzle-orm'
import type { AppRequestContext } from '@/lib/server/context'
import { getDb, schema, type Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { requireSession, unauthorized } from './control-plane'

type RequestBoundary = Request | AppRequestContext

export type TeamErrorCode =
  | 'TEAM_NOT_FOUND'
  | 'TEAM_ACCESS_DENIED'
  | 'TEAM_NAME_EXISTS'
  | 'TEAM_MEMBER_EXISTS'
  | 'TEAM_MEMBER_NOT_FOUND'
  | 'TEAM_OWNER_REQUIRES_TRANSFER'
  | 'TEAM_OWNER_TRANSFER_CONFLICT'
  | 'TEAM_HAS_ISSUES'
  | 'INVALID_TEAM_MEMBER'
  | 'ISSUE_TEAM_ACCESS_DENIED'
  | 'TEAM_OPERATION_FAILED'

/**
 * Stable Team error envelope. The UI keys off `code`; `error` stays
 * human-readable and never carries database details.
 */
export function teamError(status: number, code: TeamErrorCode, message: string) {
  return Response.json({ error: message, code }, { status })
}

async function dbFor(input: RequestBoundary): Promise<Db> {
  return input instanceof Request ? getDb(appEnv) : input.db()
}

/** Owner/admin roles manage every Team in the workspace. */
export function isWorkspaceManager(role: string | null | undefined) {
  return role === 'owner' || role === 'admin'
}

type WorkspaceMembership = {
  organizationId: string
  role: string
}

export interface TeamAccess {
  session: NonNullable<Awaited<ReturnType<typeof requireSession>>>
  db: Db
  team: typeof schema.team.$inferSelect
  workspaceMembership: WorkspaceMembership
  teamMembership: typeof schema.teamMember.$inferSelect | null
  canManage: boolean
  canTransferOwner: boolean
}

/**
 * Loads the authenticated workspace membership and Team membership from the
 * same workspace. Returns 401 without a session, 403 for a Team the caller
 * cannot access, and 404 only when the Team does not exist.
 *
 * Access model: workspace owners/admins reach every Team; everyone else must
 * have a team_member row (which includes the Team owner).
 */
export async function requireTeamAccess(
  input: RequestBoundary,
  teamId: string,
): Promise<TeamAccess | Response> {
  const session = await requireSession(input)
  if (!session) return unauthorized()

  const db = await dbFor(input)
  const [team] = await db
    .select()
    .from(schema.team)
    .where(eq(schema.team.id, teamId))
  if (!team) return teamError(404, 'TEAM_NOT_FOUND', 'Team not found')

  const [workspaceMembership] = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, team.workspaceId),
        eq(schema.member.userId, session.user.id),
      ),
    )
  if (!workspaceMembership) {
    return teamError(403, 'TEAM_ACCESS_DENIED', 'Team access denied')
  }

  const [teamMembership] = await db
    .select()
    .from(schema.teamMember)
    .where(
      and(
        eq(schema.teamMember.teamId, team.id),
        eq(schema.teamMember.userId, session.user.id),
      ),
    )

  const manager = isWorkspaceManager(workspaceMembership.role)
  if (!manager && !teamMembership) {
    return teamError(403, 'TEAM_ACCESS_DENIED', 'Team access denied')
  }

  return {
    session,
    db,
    team,
    workspaceMembership,
    teamMembership: teamMembership ?? null,
    canManage: manager || team.ownerUserId === session.user.id,
    canTransferOwner: manager,
  }
}

/** Workspace owner/admin or the Team owner. */
export async function requireTeamManage(
  input: RequestBoundary,
  teamId: string,
): Promise<TeamAccess | Response> {
  const access = await requireTeamAccess(input, teamId)
  if (access instanceof Response) return access
  if (!access.canManage) {
    return teamError(403, 'TEAM_ACCESS_DENIED', 'Team management denied')
  }
  return access
}

/** Workspace owner/admin only — Team owners cannot transfer ownership. */
export async function requireTeamOwnerTransfer(
  input: RequestBoundary,
  teamId: string,
): Promise<TeamAccess | Response> {
  const access = await requireTeamAccess(input, teamId)
  if (access instanceof Response) return access
  if (!access.canTransferOwner) {
    return teamError(
      403,
      'TEAM_ACCESS_DENIED',
      'Only workspace owners and admins can transfer Team ownership',
    )
  }
  return access
}

/** Caller must hold a team_member row. Workspace managers without one fail. */
export async function requireTeamMember(
  input: RequestBoundary,
  teamId: string,
): Promise<TeamAccess | Response> {
  const access = await requireTeamAccess(input, teamId)
  if (access instanceof Response) return access
  if (!access.teamMembership) {
    return teamError(403, 'TEAM_ACCESS_DENIED', 'Team membership required')
  }
  return access
}
