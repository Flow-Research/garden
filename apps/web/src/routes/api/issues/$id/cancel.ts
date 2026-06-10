import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import {
  cancelIssueRun,
  getActiveIssueRun,
  type IssueRunServiceError,
} from '@garden/server/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/cancel')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(request, issue.workspaceId)
        if (access instanceof Response) return access

        const runResult = await getActiveIssueRun({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runResult.isErr()) return runError(runResult.error)
        if (!runResult.value) return notFound('Active run not found')

        const cancelResult = await cancelIssueRun(appEnv, {
          workspaceId: issue.workspaceId,
          runId: runResult.value.id,
          actor: { type: 'member', id: access.session.user.id },
          reason: 'user_cancelled',
        })
        if (cancelResult.isErr()) return runError(cancelResult.error)
        return Response.json({ ok: true })
      },
    },
  },
})
