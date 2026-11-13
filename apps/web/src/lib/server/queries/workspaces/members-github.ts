import { and, eq, inArray } from 'drizzle-orm'
import { schema, type Db } from '@/lib/server/db'

/**
 * Hydrates Better Auth listMembers rows with github_* from Garden's member
 * table. Used by `GET /api/workspaces/$id/members`.
 *
 * Before: lived in `workspace-members.ts` and was called from the route.
 * After: queries own the SQL; `workspace-members` re-exports for older callers.
 */
export async function githubIdentityByMemberId(args: {
  db: Db
  workspaceId: string
  memberIds: string[]
}) {
  if (args.memberIds.length === 0) {
    return new Map<
      string,
      { githubUserId: string | null; githubLogin: string | null }
    >()
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
