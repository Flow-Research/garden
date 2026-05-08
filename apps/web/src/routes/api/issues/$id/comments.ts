import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { postIssueComment, toIssueComment } from '@garden/core/issues/server'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  commentBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/$id/comments')({
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

        const comments = await db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.issueId, params.id))

        return Response.json(comments.map(toIssueComment))
      },
      POST: async ({ request, params }) => {
        const bodyResult = await parseJsonBody(
          request,
          commentBodySchema,
          'Comment content is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({
            id: schema.issue.id,
            workspaceId: schema.issue.workspaceId,
          })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const commentResult = await postIssueComment({
          databaseUrl: appEnv.DATABASE_URL,
          workspaceId: existingIssue.workspaceId,
          issueIdOrIdentifier: params.id,
          authorUserId: access.session.user.id,
          body: body.content,
          parentId: body.parent_id ?? null,
          issueRunEnv: appEnv,
        })
        if (commentResult.isErr()) return badRequest(commentResult.error.message)

        return Response.json(commentResult.value.comment, { status: 201 })
      },
    },
  },
})
