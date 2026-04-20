import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
  toIssue,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const [issue] = await db
          .select()
          .from(schema.issue)
          .where(
            and(
              eq(schema.issue.id, params.id),
              eq(schema.issue.workspaceId, existingIssue.workspaceId),
            ),
          )

        if (!issue) return notFound('Issue not found')
        return Response.json(toIssue(issue))
      },
      PUT: async ({ request, params }) => {
        const body = (await request.json().catch(() => null)) as Record<
          string,
          unknown
        > | null
        const updateValues: Partial<typeof schema.issue.$inferInsert> = {}

        if (typeof body?.title === 'string') updateValues.title = body.title
        if (typeof body?.description === 'string')
          updateValues.description = body.description
        if (typeof body?.status === 'string') updateValues.status = body.status
        if (typeof body?.priority === 'string')
          updateValues.priority = body.priority
        if (body && Object.prototype.hasOwnProperty.call(body, 'assignee_id')) {
          updateValues.assigneeId =
            typeof body.assignee_id === 'string' ? body.assignee_id : null
          updateValues.assigneeType =
            typeof body.assignee_id === 'string'
              ? body.assignee_type === 'agent'
                ? 'agent'
                : 'user'
              : null
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'parent_issue_id')) {
          updateValues.parentId =
            typeof body.parent_issue_id === 'string' ? body.parent_issue_id : null
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'project_id')) {
          updateValues.projectId =
            typeof body.project_id === 'string' ? body.project_id : null
        }

        if (Object.keys(updateValues).length === 0) {
          return badRequest('No valid issue changes submitted')
        }

        updateValues.updatedAt = new Date()

        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const [issue] = await db
          .update(schema.issue)
          .set(updateValues)
          .where(
            and(
              eq(schema.issue.id, params.id),
              eq(schema.issue.workspaceId, existingIssue.workspaceId),
            ),
          )
          .returning()

        if (!issue) return notFound('Issue not found')
        return Response.json(toIssue(issue))
      },
      DELETE: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        await db.delete(schema.issue).where(
          and(
            eq(schema.issue.id, params.id),
            eq(schema.issue.workspaceId, existingIssue.workspaceId),
          ),
        )

        return new Response(null, { status: 204 })
      },
    },
  },
})
