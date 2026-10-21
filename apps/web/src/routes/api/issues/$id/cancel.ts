import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { notFound } from '@/lib/server/control-plane'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  requireWorkspaceMember,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  cancelIssueRun,
  getActiveIssueRun,
} from '@garden/server/issues/run-service'

export const Route = createFileRoute('/api/issues/$id/cancel')({
  server: {
    handlers: {
      POST: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceMember(
          appContext,
          issue.workspaceId,
          workspacePermissions.issueManage,
        )
        if (access instanceof Response) return access

        const runResult = await getActiveIssueRun({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runResult.isErr()) return serviceErrorResponse(runResult.error)
        if (!runResult.value) return notFound('Active run not found')

        const cancelResult = await cancelIssueRun(appEnv, {
          workspaceId: issue.workspaceId,
          runId: runResult.value.id,
          actor: { type: 'member', id: access.session.user.id },
          reason: 'user_cancelled',
        })
        if (cancelResult.isErr())
          return serviceErrorResponse(cancelResult.error)
        return Response.json({ ok: true })
      },
    },
  },
})
