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
  resolveWorkspaceId,
  toIssue,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/search')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {

        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json({ issues: [], total: 0 })

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

        const db = await appContext.db()
        const issueWhere = and(
          eq(schema.issue.workspaceId, workspaceId),
          includeClosed ? undefined : sql`${schema.issue.status} <> 'done'`,
          or(
            ilike(schema.issue.title, `%${q}%`),
            ilike(schema.issue.description, `%${q}%`),
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
              includeClosed ? undefined : sql`${schema.issue.status} <> 'done'`,
              ilike(schema.issueComment.body, `%${q}%`),
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
            const baseIssue = toIssue(issue)
            const titleHit = issue.title.toLowerCase().includes(q.toLowerCase())
            const descriptionHit = issue.description
              ?.toLowerCase()
              .includes(q.toLowerCase())

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
