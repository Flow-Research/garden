import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  createIssueBodySchema,
  issuesListSearchSchema,
  parseJsonBody,
  parseSearchParams,
} from '@/lib/server/api-validation'
import {
  badRequest,
  notFound,
  requireSession,
  resolveWorkspaceId,
  toIssue,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json({ issues: [], total: 0 })
        const searchResult = parseSearchParams(
          request,
          issuesListSearchSchema,
          'Invalid issue query',
        )
        if (searchResult.isErr()) return badRequest(searchResult.error.message)

        const {
          assignee_id: assigneeId,
          assignee_ids: assigneeIds,
          creator_id: creatorId,
          limit,
          offset,
          open_only: openOnly = false,
          priority,
          status,
        } = searchResult.value
        const db = getDb(appEnv)

        const conditions = [eq(schema.issue.workspaceId, workspaceId)]
        if (status) conditions.push(eq(schema.issue.status, status))
        if (priority) conditions.push(eq(schema.issue.priority, priority))
        if (assigneeId) conditions.push(eq(schema.issue.assigneeId, assigneeId))
        if (assigneeIds && assigneeIds.length > 0) {
          conditions.push(inArray(schema.issue.assigneeId, assigneeIds))
        }
        if (creatorId) conditions.push(eq(schema.issue.createdBy, creatorId))
        if (openOnly) conditions.push(sql`${schema.issue.status} <> 'done'`)

        const whereClause = and(...conditions)
        const [{ count }] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(schema.issue)
          .where(whereClause)

        const query = db
          .select()
          .from(schema.issue)
          .where(whereClause)
          .orderBy(
            desc(schema.issue.updatedAt),
            desc(schema.issue.createdAt),
            desc(schema.issue.number),
          )

        const limitValue = typeof limit === 'number' ? limit : null
        const offsetValue = typeof offset === 'number' ? offset : 0
        const safeLimit =
          limitValue !== null && Number.isFinite(limitValue) && limitValue > 0
            ? limitValue
            : null
        const safeOffset =
          Number.isFinite(offsetValue) && offsetValue > 0 ? offsetValue : 0
        const rows = await (safeLimit !== null
          ? query.limit(safeLimit).offset(safeOffset)
          : query.offset(safeOffset))

        return Response.json({ issues: rows.map(toIssue), total: count })
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return notFound('Workspace not found')
        const bodyResult = await parseJsonBody(
          request,
          createIssueBodySchema,
          'Invalid issue payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const db = getDb(appEnv)
        const numbers = await db
          .select({ number: schema.issue.number })
          .from(schema.issue)
          .where(eq(schema.issue.workspaceId, workspaceId))
        const nextNumber =
          numbers.reduce((max, row) => Math.max(max, row.number), 0) + 1
        const issueValues = {
          id: crypto.randomUUID(),
          workspaceId,
          number: nextNumber,
          title: body.title,
          description:
            typeof body.description === 'string' ? body.description : null,
          status: body.status ?? 'backlog',
          priority: body.priority ?? 'medium',
          createdBy: session.user.id,
          assigneeType:
            typeof body.assignee_id === 'string'
              ? body.assignee_type === 'agent'
                ? 'agent'
                : 'user'
              : null,
          assigneeId: body.assignee_id ?? null,
          parentId: body.parent_issue_id ?? null,
          projectId: body.project_id ?? null,
        } as typeof schema.issue.$inferInsert
        const [issue] = await db
          .insert(schema.issue)
          .values(issueValues)
          .returning()
        return Response.json(toIssue(issue), { status: 201 })
      },
    },
  },
})
