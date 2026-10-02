import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import type {
  AddTeamMemberRequest,
  CreateTeamRequest,
  Team,
  TeamCurrentMembership,
  TeamMember,
  TeamSummary,
  UpdateTeamRequest,
} from '@garden/core/types'
import { schema, type Db } from '@/lib/server/db'
import { isWorkspaceManager, type TeamErrorCode } from './team-access'

type TeamRow = typeof schema.team.$inferSelect
type TeamMemberRow = typeof schema.teamMember.$inferSelect
type ActivityActor = { type: 'user' | 'agent'; id: string }
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export class TeamServiceError extends TaggedError('TeamServiceError')<{
  code: TeamErrorCode
  status: number
  message: string
}>() {}

function serviceError(
  code: TeamErrorCode,
  status: number,
  message: string,
): TeamServiceError {
  return new TeamServiceError({ code, status, message })
}

function isPgError(
  error: unknown,
): error is { code?: string; constraint?: string } {
  return typeof error === 'object' && error !== null && 'code' in error
}

/**
 * Maps Postgres constraint failures onto stable Team error codes. Constraint
 * names are checked instead of message text; anything unknown becomes a
 * generic operation failure so raw database errors never reach the client.
 */
function mapDbError(error: unknown): TeamServiceError {
  if (!isPgError(error)) {
    return serviceError(
      'TEAM_OPERATION_FAILED',
      500,
      'Team operation failed',
    )
  }
  if (error.code === '23505') {
    if (error.constraint === 'team_workspace_name_unique') {
      return serviceError(
        'TEAM_NAME_EXISTS',
        409,
        'A Team with this name already exists',
      )
    }
    return serviceError(
      'TEAM_MEMBER_EXISTS',
      409,
      'This member already belongs to the Team',
    )
  }
  if (error.code === '23514' || error.code === '23503') {
    return serviceError(
      'INVALID_TEAM_MEMBER',
      400,
      'The selected member is not valid for this Team',
    )
  }
  return serviceError('TEAM_OPERATION_FAILED', 500, 'Team operation failed')
}

export function toCurrentMembership(
  row: TeamMemberRow,
): TeamCurrentMembership {
  return {
    id: row.id,
    member_type: row.userId ? 'user' : 'agent',
    user_id: row.userId ?? null,
    agent_id: row.agentId ?? null,
  }
}

export function toTeam(
  record: TeamRow,
  options: {
    memberCount: number
    issueCount: number
    canManage: boolean
    canTransferOwner: boolean
    currentMembership: TeamCurrentMembership | null
  },
): Team {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    name: record.name,
    description: record.description ?? null,
    owner_user_id: record.ownerUserId,
    created_by: record.createdBy,
    member_count: options.memberCount,
    issue_count: options.issueCount,
    can_manage: options.canManage,
    can_transfer_owner: options.canTransferOwner,
    current_membership: options.currentMembership,
    created_at: new Date(record.createdAt).toISOString(),
    updated_at: new Date(record.updatedAt).toISOString(),
  }
}

interface TeamMemberQueryRow {
  membership: TeamMemberRow
  userName: string | null
  userEmail: string | null
  userAvatarUrl: string | null
  agentName: string | null
  agentStatus: string | null
  workspaceRole: string | null
  assignedIssueCount: number
}

function toTeamMember(row: TeamMemberQueryRow): TeamMember {
  const human = row.membership.userId !== null
  return {
    id: row.membership.id,
    team_id: row.membership.teamId,
    workspace_id: row.membership.workspaceId,
    member_type: human ? 'user' : 'agent',
    user_id: row.membership.userId ?? null,
    agent_id: row.membership.agentId ?? null,
    name: (human ? row.userName : row.agentName) ?? 'Unknown member',
    email: human ? (row.userEmail ?? null) : null,
    avatar_url: human ? (row.userAvatarUrl ?? null) : null,
    workspace_role: human ? ((row.workspaceRole as TeamMember['workspace_role']) ?? null) : null,
    agent_status: human ? null : ((row.agentStatus as TeamMember['agent_status']) ?? null),
    assigned_issue_count: row.assignedIssueCount,
    created_at: new Date(row.membership.createdAt).toISOString(),
  }
}

function teamMemberSelect(db: Db) {
  return db
    .select({
      membership: schema.teamMember,
      userName: schema.user.name,
      userEmail: schema.user.email,
      userAvatarUrl: schema.user.avatarUrl,
      agentName: schema.agent.name,
      agentStatus: schema.agent.status,
      workspaceRole: schema.member.role,
      assignedIssueCount: sql<number>`(
        select cast(count(*) as int) from ${schema.issue} i
        where i.team_id = "team_member"."team_id"
          and i.assignee_type = case when "team_member"."user_id" is not null then 'user' else 'agent' end
          and i.assignee_id = coalesce("team_member"."user_id", "team_member"."agent_id")
      )`,
    })
    .from(schema.teamMember)
    .leftJoin(schema.user, eq(schema.user.id, schema.teamMember.userId))
    .leftJoin(schema.agent, eq(schema.agent.id, schema.teamMember.agentId))
    .leftJoin(
      schema.member,
      and(
        eq(schema.member.userId, schema.teamMember.userId),
        eq(schema.member.organizationId, schema.teamMember.workspaceId),
      ),
    )
}

export async function listTeamMembers(args: {
  db: Db
  teamId: string
}): Promise<TeamMember[]> {
  const rows = await teamMemberSelect(args.db)
    .where(eq(schema.teamMember.teamId, args.teamId))
    .orderBy(schema.teamMember.createdAt)
  return rows.map(toTeamMember)
}

export async function loadTeamMember(args: {
  db: Db
  teamId: string
  membershipId: string
}): Promise<TeamMember | null> {
  const [row] = await teamMemberSelect(args.db).where(
    and(
      eq(schema.teamMember.teamId, args.teamId),
      eq(schema.teamMember.id, args.membershipId),
    ),
  )
  return row ? toTeamMember(row) : null
}

/**
 * Issue counts respect the caller's visibility: managers and the Team owner
 * see every Team issue; everyone else only issues assigned to them.
 */
function issueVisibilityCondition(args: {
  manager: boolean
  viewerId: string
}) {
  if (args.manager) return sql`true`
  return sql`("team"."owner_user_id" = ${args.viewerId} or (i.assignee_type = 'user' and i.assignee_id = ${args.viewerId}))`
}

export async function getTeamForViewer(args: {
  db: Db
  team: TeamRow
  viewerId: string
  viewerRole: string
}): Promise<Team> {
  const manager = isWorkspaceManager(args.viewerRole)
  const [counts] = await args.db
    .select({
      memberCount: sql<number>`(select cast(count(*) as int) from "team_member" where "team_member"."team_id" = "team"."id")`,
      issueCount: sql<number>`(select cast(count(*) as int) from ${schema.issue} i where i.team_id = "team"."id" and ${issueVisibilityCondition({
        manager,
        viewerId: args.viewerId,
      })})`,
    })
    .from(schema.team)
    .where(eq(schema.team.id, args.team.id))

  const [membership] = await args.db
    .select()
    .from(schema.teamMember)
    .where(
      and(
        eq(schema.teamMember.teamId, args.team.id),
        eq(schema.teamMember.userId, args.viewerId),
      ),
    )

  return toTeam(args.team, {
    memberCount: counts?.memberCount ?? 0,
    issueCount: counts?.issueCount ?? 0,
    canManage: manager || args.team.ownerUserId === args.viewerId,
    canTransferOwner: manager,
    currentMembership: membership ? toCurrentMembership(membership) : null,
  })
}

/**
 * Lists visible Teams with per-caller counts. Normal members only see Teams
 * they belong to; managers see every Team in the workspace.
 */
export async function listTeams(args: {
  db: Db
  workspaceId: string
  viewerId: string
  viewerRole: string
}): Promise<TeamSummary[]> {
  const manager = isWorkspaceManager(args.viewerRole)
  const rows = await args.db
    .select({
      team: schema.team,
      memberCount: sql<number>`(select cast(count(*) as int) from "team_member" where "team_member"."team_id" = "team"."id")`,
      issueCount: sql<number>`(select cast(count(*) as int) from ${schema.issue} i where i.team_id = "team"."id" and ${issueVisibilityCondition(
        {
          manager,
          viewerId: args.viewerId,
        },
      )})`,
    })
    .from(schema.team)
    .where(
      manager
        ? eq(schema.team.workspaceId, args.workspaceId)
        : and(
            eq(schema.team.workspaceId, args.workspaceId),
            sql`exists (select 1 from "team_member" tm where tm.team_id = "team"."id" and tm.user_id = ${args.viewerId})`,
          ),
    )
    .orderBy(schema.team.updatedAt)

  const memberships = await args.db
    .select()
    .from(schema.teamMember)
    .where(
      and(
        eq(schema.teamMember.workspaceId, args.workspaceId),
        eq(schema.teamMember.userId, args.viewerId),
      ),
    )
  const membershipByTeam = new Map(
    memberships.map((membership) => [membership.teamId, membership]),
  )

  return rows.map((row) => {
    const membership = membershipByTeam.get(row.team.id)
    return toTeam(row.team, {
      memberCount: row.memberCount,
      issueCount: row.issueCount,
      canManage: manager || row.team.ownerUserId === args.viewerId,
      canTransferOwner: manager,
      currentMembership: membership ? toCurrentMembership(membership) : null,
    })
  })
}

type CreateOutcome =
  | { kind: 'ok'; team: TeamRow; memberships: TeamMemberRow[] }
  | { kind: 'invalid'; message: string }
  | { kind: 'name_exists' }

/**
 * Creates a Team and its initial memberships in one transaction. The owner
 * defaults to the authenticated creator, must be a workspace member, and is
 * always a Team member. Any invalid selected member aborts the transaction
 * with no Team written.
 */
export async function createTeam(args: {
  db: Db
  workspaceId: string
  actorUserId: string
  input: CreateTeamRequest
}): Promise<Result<Team, TeamServiceError>> {
  const name = args.input.name.trim()
  const outcomeResult = await Result.tryPromise({
    try: async () =>
      args.db.transaction(async (tx): Promise<CreateOutcome> => {
        const ownerUserId = args.input.owner_user_id ?? args.actorUserId

        const [ownerMembership] = await tx
          .select({ role: schema.member.role })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, args.workspaceId),
              eq(schema.member.userId, ownerUserId),
            ),
          )
        if (!ownerMembership) {
          return {
            kind: 'invalid',
            message: 'Team owner must be a workspace member',
          }
        }

        const deduped = new Map<string, AddTeamMemberRequest>()
        for (const entry of args.input.initial_members ?? []) {
          deduped.set(
            entry.member_type === 'user'
              ? `user:${entry.user_id}`
              : `agent:${entry.agent_id}`,
            entry,
          )
        }
        const ownerKey = `user:${ownerUserId}`
        if (
          args.input.owner_user_id !== undefined &&
          (args.input.initial_members?.length ?? 0) > 0 &&
          !deduped.has(ownerKey)
        ) {
          return {
            kind: 'invalid',
            message: 'Initial members must include the Team owner',
          }
        }
        deduped.set(ownerKey, { member_type: 'user', user_id: ownerUserId })

        for (const entry of deduped.values()) {
          if (entry.member_type === 'user') {
            const [row] = await tx
              .select({ userId: schema.member.userId })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.organizationId, args.workspaceId),
                  eq(schema.member.userId, entry.user_id),
                ),
              )
            if (!row) {
              return {
                kind: 'invalid',
                message: 'Selected user is not a workspace member',
              }
            }
          } else {
            const [row] = await tx
              .select({ id: schema.agent.id })
              .from(schema.agent)
              .where(
                and(
                  eq(schema.agent.id, entry.agent_id),
                  eq(schema.agent.workspaceId, args.workspaceId),
                  eq(schema.agent.status, 'active'),
                ),
              )
            if (!row) {
              return {
                kind: 'invalid',
                message: 'Selected agent is not an active workspace agent',
              }
            }
          }
        }

        const [existing] = await tx
          .select({ id: schema.team.id })
          .from(schema.team)
          .where(
            and(
              eq(schema.team.workspaceId, args.workspaceId),
              sql`lower(${schema.team.name}) = lower(${name})`,
            ),
          )
        if (existing) return { kind: 'name_exists' }

        const teamId = randomUUID()
        const [created] = await tx
          .insert(schema.team)
          .values({
            id: teamId,
            workspaceId: args.workspaceId,
            name,
            description: args.input.description ?? null,
            ownerUserId,
            createdBy: args.actorUserId,
          })
          .returning()
        if (!created) {
          return { kind: 'invalid', message: 'Team insert returned no row' }
        }

        const memberships = await tx
          .insert(schema.teamMember)
          .values(
            Array.from(deduped.values()).map((entry) => ({
              id: randomUUID(),
              teamId,
              workspaceId: args.workspaceId,
              userId: entry.member_type === 'user' ? entry.user_id : null,
              agentId: entry.member_type === 'agent' ? entry.agent_id : null,
              createdBy: args.actorUserId,
            })),
          )
          .returning()

        await writeTeamActivity(tx, {
          workspaceId: args.workspaceId,
          teamId,
          actor: { type: 'user', id: args.actorUserId },
          eventType: 'team.created',
          payload: { team_id: teamId, name: created.name },
        })

        return { kind: 'ok', team: created, memberships }
      }),
    catch: mapDbError,
  })

  if (outcomeResult.isErr()) return Result.err(outcomeResult.error)
  const outcome = outcomeResult.value
  if (outcome.kind === 'invalid') {
    return Result.err(
      serviceError('INVALID_TEAM_MEMBER', 400, outcome.message),
    )
  }
  if (outcome.kind === 'name_exists') {
    return Result.err(
      serviceError(
        'TEAM_NAME_EXISTS',
        409,
        'A Team with this name already exists',
      ),
    )
  }

  const membership = outcome.memberships.find(
    (row) => row.userId === args.actorUserId,
  )
  return Result.ok(
    toTeam(outcome.team, {
      memberCount: outcome.memberships.length,
      issueCount: 0,
      canManage: true,
      canTransferOwner: true,
      currentMembership: membership ? toCurrentMembership(membership) : null,
    }),
  )
}

export async function updateTeam(args: {
  db: Db
  team: TeamRow
  actorUserId: string
  input: UpdateTeamRequest
}): Promise<Result<TeamRow, TeamServiceError>> {
  const name = args.input.name?.trim()
  const outcomeResult = await Result.tryPromise({
    try: async () =>
      args.db.transaction(async (tx) => {
        if (name !== undefined) {
          const [existing] = await tx
            .select({ id: schema.team.id })
            .from(schema.team)
            .where(
              and(
                eq(schema.team.workspaceId, args.team.workspaceId),
                sql`lower(${schema.team.name}) = lower(${name})`,
                sql`${schema.team.id} <> ${args.team.id}`,
              ),
            )
          if (existing) return { kind: 'name_exists' as const }
        }

        const [updated] = await tx
          .update(schema.team)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(args.input.description !== undefined
              ? { description: args.input.description }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.team.id, args.team.id))
          .returning()
        if (!updated) return { kind: 'not_found' as const }

        await writeTeamActivity(tx, {
          workspaceId: args.team.workspaceId,
          teamId: args.team.id,
          actor: { type: 'user', id: args.actorUserId },
          eventType: 'team.updated',
          payload: {
            team_id: args.team.id,
            fields: [
              ...(name !== undefined ? ['name'] : []),
              ...(args.input.description !== undefined ? ['description'] : []),
            ],
          },
        })

        return { kind: 'ok' as const, team: updated }
      }),
    catch: mapDbError,
  })

  if (outcomeResult.isErr()) return Result.err(outcomeResult.error)
  const outcome = outcomeResult.value
  if (outcome.kind === 'name_exists') {
    return Result.err(
      serviceError(
        'TEAM_NAME_EXISTS',
        409,
        'A Team with this name already exists',
      ),
    )
  }
  if (outcome.kind === 'not_found') {
    return Result.err(serviceError('TEAM_NOT_FOUND', 404, 'Team not found'))
  }
  return Result.ok(outcome.team)
}

export async function transferTeamOwner(args: {
  db: Db
  team: TeamRow
  actorUserId: string
  ownerUserId: string
}): Promise<Result<TeamRow, TeamServiceError>> {
  const outcomeResult = await Result.tryPromise({
    try: async () =>
      args.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.team)
          .where(eq(schema.team.id, args.team.id))
          .for('update')
        if (!locked) return { kind: 'not_found' as const }

        const [workspaceMembership] = await tx
          .select({ userId: schema.member.userId })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, locked.workspaceId),
              eq(schema.member.userId, args.ownerUserId),
            ),
          )
        if (!workspaceMembership) {
          return {
            kind: 'invalid' as const,
            message: 'Team owner must be a workspace member',
          }
        }

        const [membership] = await tx
          .select({ id: schema.teamMember.id })
          .from(schema.teamMember)
          .where(
            and(
              eq(schema.teamMember.teamId, locked.id),
              eq(schema.teamMember.userId, args.ownerUserId),
            ),
          )
        if (!membership) {
          return {
            kind: 'invalid' as const,
            message: 'Team owner must be a current Team member',
          }
        }

        if (locked.ownerUserId === args.ownerUserId) {
          return { kind: 'ok' as const, team: locked }
        }

        const [updated] = await tx
          .update(schema.team)
          .set({ ownerUserId: args.ownerUserId, updatedAt: new Date() })
          .where(
            and(
              eq(schema.team.id, locked.id),
              eq(schema.team.ownerUserId, locked.ownerUserId),
            ),
          )
          .returning()
        if (!updated) return { kind: 'conflict' as const }

        await writeTeamActivity(tx, {
          workspaceId: locked.workspaceId,
          teamId: locked.id,
          actor: { type: 'user', id: args.actorUserId },
          eventType: 'team.owner_transferred',
          payload: {
            team_id: locked.id,
            previous_owner_user_id: locked.ownerUserId,
            owner_user_id: args.ownerUserId,
          },
        })

        return { kind: 'ok' as const, team: updated }
      }),
    catch: mapDbError,
  })

  if (outcomeResult.isErr()) return Result.err(outcomeResult.error)
  const outcome = outcomeResult.value
  if (outcome.kind === 'not_found') {
    return Result.err(serviceError('TEAM_NOT_FOUND', 404, 'Team not found'))
  }
  if (outcome.kind === 'invalid') {
    return Result.err(serviceError('INVALID_TEAM_MEMBER', 400, outcome.message))
  }
  if (outcome.kind === 'conflict') {
    return Result.err(
      serviceError(
        'TEAM_OWNER_TRANSFER_CONFLICT',
        409,
        'Team ownership changed while transferring; retry',
      ),
    )
  }
  return Result.ok(outcome.team)
}

export async function addTeamMember(args: {
  db: Db
  team: TeamRow
  actorUserId: string
  member: AddTeamMemberRequest
}): Promise<Result<TeamMemberRow, TeamServiceError>> {
  const outcomeResult = await Result.tryPromise({
    try: async () =>
      args.db.transaction(async (tx) => {
        if (args.member.member_type === 'user') {
          const [row] = await tx
            .select({ userId: schema.member.userId })
            .from(schema.member)
            .where(
              and(
                eq(schema.member.organizationId, args.team.workspaceId),
                eq(schema.member.userId, args.member.user_id),
              ),
            )
          if (!row) return { kind: 'invalid' as const }
        } else {
          const [row] = await tx
            .select({ id: schema.agent.id })
            .from(schema.agent)
            .where(
              and(
                eq(schema.agent.id, args.member.agent_id),
                eq(schema.agent.workspaceId, args.team.workspaceId),
                eq(schema.agent.status, 'active'),
              ),
            )
          if (!row) return { kind: 'invalid' as const }
        }

        const identityCondition =
          args.member.member_type === 'user'
            ? eq(schema.teamMember.userId, args.member.user_id)
            : eq(schema.teamMember.agentId, args.member.agent_id)
        const [existing] = await tx
          .select({ id: schema.teamMember.id })
          .from(schema.teamMember)
          .where(
            and(eq(schema.teamMember.teamId, args.team.id), identityCondition),
          )
        if (existing) return { kind: 'member_exists' as const }

        const [created] = await tx
          .insert(schema.teamMember)
          .values({
            id: randomUUID(),
            teamId: args.team.id,
            workspaceId: args.team.workspaceId,
            userId:
              args.member.member_type === 'user'
                ? args.member.user_id
                : null,
            agentId:
              args.member.member_type === 'agent'
                ? args.member.agent_id
                : null,
            createdBy: args.actorUserId,
          })
          .returning()
        if (!created) return { kind: 'invalid' as const }

        await writeTeamActivity(tx, {
          workspaceId: args.team.workspaceId,
          teamId: args.team.id,
          actor: { type: 'user', id: args.actorUserId },
          eventType: 'team.member_added',
          payload: {
            team_id: args.team.id,
            member_type: args.member.member_type,
            member_id:
              args.member.member_type === 'user'
                ? args.member.user_id
                : args.member.agent_id,
          },
        })

        return { kind: 'ok' as const, membership: created }
      }),
    catch: mapDbError,
  })

  if (outcomeResult.isErr()) return Result.err(outcomeResult.error)
  const outcome = outcomeResult.value
  if (outcome.kind === 'invalid') {
    return Result.err(
      serviceError(
        'INVALID_TEAM_MEMBER',
        400,
        'The selected member is not an active workspace member',
      ),
    )
  }
  if (outcome.kind === 'member_exists') {
    return Result.err(
      serviceError(
        'TEAM_MEMBER_EXISTS',
        409,
        'This member already belongs to the Team',
      ),
    )
  }
  return Result.ok(outcome.membership)
}

export async function removeTeamMember(args: {
  db: Db
  team: TeamRow
  actorUserId: string
  membershipId: string
}): Promise<Result<void, TeamServiceError>> {
  const outcomeResult = await Result.tryPromise({
    try: async () =>
      args.db.transaction(async (tx) => {
        const [membership] = await tx
          .select()
          .from(schema.teamMember)
          .where(
            and(
              eq(schema.teamMember.id, args.membershipId),
              eq(schema.teamMember.teamId, args.team.id),
            ),
          )
        if (!membership) return { kind: 'not_found' as const }

        if (
          membership.userId &&
          membership.userId === args.team.ownerUserId
        ) {
          return { kind: 'owner' as const }
        }

        await tx
          .delete(schema.teamMember)
          .where(eq(schema.teamMember.id, membership.id))

        await writeTeamActivity(tx, {
          workspaceId: args.team.workspaceId,
          teamId: args.team.id,
          actor: { type: 'user', id: args.actorUserId },
          eventType: 'team.member_removed',
          payload: {
            team_id: args.team.id,
            member_type: membership.userId ? 'user' : 'agent',
            member_id: membership.userId ?? membership.agentId,
          },
        })

        return { kind: 'ok' as const }
      }),
    catch: mapDbError,
  })

  if (outcomeResult.isErr()) return Result.err(outcomeResult.error)
  const outcome = outcomeResult.value
  if (outcome.kind === 'not_found') {
    return Result.err(
      serviceError('TEAM_MEMBER_NOT_FOUND', 404, 'Team member not found'),
    )
  }
  if (outcome.kind === 'owner') {
    return Result.err(
      serviceError(
        'TEAM_OWNER_REQUIRES_TRANSFER',
        409,
        'Transfer Team ownership before removing the owner',
      ),
    )
  }
  return Result.ok(undefined)
}

export async function deleteTeam(args: {
  db: Db
  team: TeamRow
  actorUserId: string
}): Promise<Result<void, TeamServiceError>> {
  const outcomeResult = await Result.tryPromise({
    try: async () =>
      args.db.transaction(async (tx) => {
        const [counts] = await tx
          .select({
            issueCount: sql<number>`cast(count(*) as int)`,
          })
          .from(schema.issue)
          .where(eq(schema.issue.teamId, args.team.id))
        if ((counts?.issueCount ?? 0) > 0) return { kind: 'has_issues' as const }

        await tx.delete(schema.team).where(eq(schema.team.id, args.team.id))

        await writeTeamActivity(tx, {
          workspaceId: args.team.workspaceId,
          teamId: args.team.id,
          actor: { type: 'user', id: args.actorUserId },
          eventType: 'team.deleted',
          payload: { team_id: args.team.id, name: args.team.name },
        })

        return { kind: 'ok' as const }
      }),
    catch: mapDbError,
  })

  if (outcomeResult.isErr()) return Result.err(outcomeResult.error)
  const outcome = outcomeResult.value
  if (outcome.kind === 'has_issues') {
    return Result.err(
      serviceError(
        'TEAM_HAS_ISSUES',
        409,
        'Team has linked issues',
      ),
    )
  }
  return Result.ok(undefined)
}

/**
 * Team activity is recorded on the existing activity_event ledger with
 * subject_type 'team'. Deletion payloads keep the Team name because the row
 * is gone by the time the event is read.
 */
async function writeTeamActivity(
  tx: Tx,
  args: {
    workspaceId: string
    teamId: string
    actor: ActivityActor
    eventType: string
    payload: Record<string, unknown>
  },
) {
  await tx.insert(schema.activityEvent).values({
    id: randomUUID(),
    workspaceId: args.workspaceId,
    subjectType: 'team',
    subjectId: args.teamId,
    actorType: args.actor.type,
    actorId: args.actor.id,
    eventType: args.eventType,
    payload: args.payload,
  })
}
