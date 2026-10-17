import { and, eq, inArray } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { isWorkspaceManager } from '@/lib/server/team-access'
import { schema, type Db } from '@/lib/server/db'

export type WorkspaceMemberRow = {
  id: string
  workspaceId: string
  userId: string
  role: string
  githubUserId: string | null
  githubLogin: string | null
  createdAt: Date | null
  name: string
  email: string
  avatarUrl: string | null
}

export class WorkspaceMemberGithubError extends TaggedError(
  'WorkspaceMemberGithubError',
)<{
  message: string
  status: number
  cause?: unknown
}>() {}

export function toMemberResponse(member: WorkspaceMemberRow) {
  return {
    id: member.id,
    workspace_id: member.workspaceId,
    user_id: member.userId,
    role: member.role,
    github_user_id: member.githubUserId,
    github_login: member.githubLogin,
    created_at: (member.createdAt ?? new Date()).toISOString(),
    name: member.name,
    email: member.email,
    avatar_url: member.avatarUrl,
  }
}

/**
 * Loads a single membership joined to the user row. Used after role/GitHub
 * writes so the API returns Garden's canonical columns (including github_*),
 * not Better Auth's list shape.
 */
export async function readWorkspaceMember(args: {
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
      githubUserId: schema.member.githubUserId,
      githubLogin: schema.member.githubLogin,
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

/**
 * Hydrates Better Auth listMembers rows with github_* from Garden's member
 * table. Phase 1 returned hardcoded nulls; without this join, linked identities
 * would never appear on GET /members.
 */
export async function githubIdentityByMemberId(args: {
  db: Db
  workspaceId: string
  memberIds: string[]
}) {
  if (args.memberIds.length === 0) {
    return new Map<string, { githubUserId: string | null; githubLogin: string | null }>()
  }

  const rows = await args.db
    .select({
      id: schema.member.id,
      githubUserId: schema.member.githubUserId,
      githubLogin: schema.member.githubLogin,
    })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, args.workspaceId),
        inArray(schema.member.id, args.memberIds),
      ),
    )

  return new Map(
    rows.map((row) => [
      row.id,
      { githubUserId: row.githubUserId, githubLogin: row.githubLogin },
    ]),
  )
}

/**
 * Self may link/unlink own GitHub identity; workspace owner/admin may edit any
 * member. Plain members cannot edit someone else's mapping.
 */
export async function canEditMemberGithubIdentity(args: {
  db: Db
  workspaceId: string
  actorUserId: string
  targetUserId: string
}) {
  if (args.actorUserId === args.targetUserId) return true

  const [actor] = await args.db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, args.workspaceId),
        eq(schema.member.userId, args.actorUserId),
      ),
    )
    .limit(1)

  return isWorkspaceManager(actor?.role)
}

/** Walks drizzle/pg wrapper causes for Postgres unique_violation. */
function isUniqueViolation(cause: unknown) {
  let current: unknown = cause
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      current !== null &&
      'code' in current &&
      current.code === '23505'
    ) {
      return true
    }
    current =
      typeof current === 'object' &&
      current !== null &&
      'cause' in current
        ? current.cause
        : undefined
  }
  return false
}

/**
 * Writes the github identity pair (or clears both for not_linked). Rejects
 * duplicate github_user_id in the same workspace via the partial unique index.
 */
export async function updateMemberGithubIdentity(args: {
  db: Db
  workspaceId: string
  memberId: string
  githubUserId: string | null
  githubLogin: string | null
}) {
  return Result.tryPromise({
    try: async () => {
      const updated = await args.db
        .update(schema.member)
        .set({
          githubUserId: args.githubUserId,
          githubLogin: args.githubLogin,
        })
        .where(
          and(
            eq(schema.member.id, args.memberId),
            eq(schema.member.organizationId, args.workspaceId),
          ),
        )
        .returning({ id: schema.member.id })

      if (updated.length === 0) {
        throw new WorkspaceMemberGithubError({
          message: 'Member not found',
          status: 404,
        })
      }
    },
    catch: (cause) => {
      if (cause instanceof WorkspaceMemberGithubError) return cause
      if (isUniqueViolation(cause)) {
        return new WorkspaceMemberGithubError({
          message:
            'That GitHub identity is already linked to another member in this workspace',
          status: 409,
          cause,
        })
      }
      return new WorkspaceMemberGithubError({
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to update GitHub identity',
        status: 500,
        cause,
      })
    },
  })
}
