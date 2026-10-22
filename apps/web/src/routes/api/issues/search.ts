import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  issueSearchQuerySchema,
  parseSearchParams,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  requireSession,
  requireWorkspaceAccess,
  resolveWorkspaceId,
  toIssue,
  unauthorized,
} from '@/lib/server/control-plane'
import { teamIssueVisibilityCondition } from '@/lib/server/issue-access'
import { isWorkspaceManager } from '@/lib/server/team-access'

export const Route = createFileRoute('/api/issues/search')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) return Response.json({ issues: [], total: 0 })

        const workspaceAccess = await requireWorkspaceAccess(
          appContext,
          workspaceId,
        )
        if (workspaceAccess instanceof Response) return workspaceAccess
        const visibility = teamIssueVisibilityCondition({
          viewerId: session.user.id,
          manager: isWorkspaceManager(workspaceAccess.membership.role),
        })

        const searchResult = parseSearchParams(
          request,
          issueSearchQuerySchema,
          'Invalid issue search query',
        )
        if (searchResult.isErr()) return badRequest(searchResult.error.message)

        const q = searchResult.value.q
        const limit = searchResult.value.limit ?? 20
        const offset = searchResult.value.offset ?? 0
        const includeClosed = searchResult.value.include_closed ?? false

        if (!q) {
          return Response.json({ issues: [], total: 0 })
        }
        const searchTerms = q.toLocaleLowerCase().split(/\s+/)

        const db = await appContext.db()
        const [workspace] = await db
          .select({ issuePrefix: schema.organization.issuePrefix })
          .from(schema.organization)
          .where(eq(schema.organization.id, workspaceId))
          .limit(1)
        const issuePrefix = workspace?.issuePrefix ?? 'ISS'
        const issueWhere = and(
          eq(schema.issue.workspaceId, workspaceId),
          visibility,
          includeClosed ? undefined : sql`${schema.issue.status} <> 'done'`,
          ...searchTerms.map((term) =>
            or(
              ilike(schema.issue.title, `%${term}%`),
              ilike(schema.issue.description, `%${term}%`),
              sql`concat(${issuePrefix}::text, '-', ${schema.issue.number}::text) ilike ${`%${term}%`}`,
            ),
          ),
        )

        const commentMatches = await db
          .select({ issueId: schema.issueComment.issueId })
          .from(schema.issueComment)
          .innerJoin(
            schema.issue,
            eq(schema.issue.id, schema.issueComment.issueId),
          )
          .where(
            and(
              eq(schema.issue.workspaceId, workspaceId),
              visibility,
              includeClosed ? undefined : sql`${schema.issue.status} <> 'done'`,
              ...searchTerms.map((term) =>
                ilike(schema.issueComment.body, `%${term}%`),
              ),
            ),
          )

        const commentIssueIds = Array.from(
          new Set(commentMatches.map((match) => match.issueId)),
        )

        const issueRows = await db
          .select()
          .from(schema.issue)
          .where(issueWhere)
          .orderBy(desc(schema.issue.updatedAt), desc(schema.issue.createdAt))

        const commentRows =
          commentIssueIds.length === 0
            ? []
            : await db
                .select()
                .from(schema.issue)
                .where(
                  and(
                    eq(schema.issue.workspaceId, workspaceId),
                    inArray(schema.issue.id, commentIssueIds),
                  ),
                )
                .orderBy(
                  desc(schema.issue.updatedAt),
                  desc(schema.issue.createdAt),
                )

        const seen = new Set<string>()
        const results = [...issueRows, ...commentRows]
          .filter((issue) => {
            if (seen.has(issue.id)) return false
            seen.add(issue.id)
            return true
          })
          .map((issue) => {
            const baseIssue = toIssue(issue, { issuePrefix })
            const title = issue.title.toLocaleLowerCase()
            const description = issue.description?.toLocaleLowerCase()
            const titleHit = searchTerms.every((term) => title.includes(term))
            const descriptionHit = searchTerms.every((term) =>
              description?.includes(term),
            )

            return {
              ...baseIssue,
              match_source: titleHit
                ? 'title'
                : descriptionHit
                  ? 'description'
                  : 'comment',
              matched_snippet: issue.description?.slice(0, 180) ?? undefined,
            }
          })

        return Response.json({
          issues: results.slice(offset, offset + limit),
          total: results.length,
        })
      },
    },
  },
})
