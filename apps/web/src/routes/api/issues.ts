import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { createIssue } from '@/lib/server/issues'
import {
  createIssueBodySchema,
  issuesListSearchSchema,
  parseJsonBody,
  parseSearchParams,
} from '@/lib/server/validation/issues'
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

        return Response.json({
          issues: rows.map((row) => toIssue(row)),
          total: count,
        })
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

        const issueResult = await createIssue({
          databaseUrl: appEnv.DATABASE_URL,
          workspaceId,
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
          dueDate: body.due_date ? new Date(body.due_date) : null,
        })
        if (issueResult.isErr()) return badRequest(issueResult.error.message)
        return Response.json(issueResult.value, { status: 201 })
      },
    },
  },
})
