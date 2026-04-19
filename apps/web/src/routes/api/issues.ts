import { eq } from 'drizzle-orm'
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
        const status = new URL(request.url).searchParams.get('status')
        const openOnly =
          new URL(request.url).searchParams.get('open_only') === 'true'
        let rows = await db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.workspaceId, workspaceId))
        if (status) rows = rows.filter((row) => row.status === status)
        if (openOnly) rows = rows.filter((row) => row.status !== 'done')
        return Response.json({ issues: rows.map(toIssue), total: rows.length })
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
          assigneeType: typeof body.assignee_id === 'string' ? 'user' : null,
          assigneeId:
            typeof body.assignee_id === 'string' ? body.assignee_id : null,
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
