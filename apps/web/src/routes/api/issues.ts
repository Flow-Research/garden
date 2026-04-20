import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
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
        const db = getDb(appEnv)
        const searchParams = new URL(request.url).searchParams
        const status = searchParams.get('status')
        const priority = searchParams.get('priority')
        const assigneeId = searchParams.get('assignee_id')
        const assigneeIds = searchParams
          .get('assignee_ids')
          ?.split(',')
          .map((value) => value.trim())
          .filter(Boolean)
        const creatorId = searchParams.get('creator_id')
        const openOnly = searchParams.get('open_only') === 'true'
        const limit = Number(searchParams.get('limit') ?? '')
        const offset = Number(searchParams.get('offset') ?? '')

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

        const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : null
        const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0
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
        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        if (typeof body?.title !== 'string')
          return badRequest('Invalid issue payload')
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
          status: typeof body.status === 'string' ? body.status : 'backlog',
          priority:
            typeof body.priority === 'string' ? body.priority : 'medium',
          createdBy: session.user.id,
          assigneeType:
            typeof body.assignee_id === 'string'
              ? body.assignee_type === 'agent'
                ? 'agent'
                : 'user'
              : null,
          assigneeId:
            typeof body.assignee_id === 'string' ? body.assignee_id : null,
          parentId:
            typeof body.parent_issue_id === 'string'
              ? body.parent_issue_id
              : null,
          projectId:
            typeof body.project_id === 'string' ? body.project_id : null,
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
