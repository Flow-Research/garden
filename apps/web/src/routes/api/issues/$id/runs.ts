import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
} from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import {
  listIssueRuns,
  startIssueRun,
  type IssueRunServiceError,
} from '@garden/server/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/runs')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const issue = access.issue

        const runsResult = await listIssueRuns({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runsResult.isErr()) return runError(runsResult.error)
        return Response.json(runsResult.value)
      },
      POST: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const db = access.db
        const issue = access.issue

        if (issue.assigneeType !== 'agent' || !issue.assigneeId) {
          return badRequest('Issue must be assigned to an agent to start a run')
        }

        const [agent] = await db
          .select({ id: schema.agent.id })
          .from(schema.agent)
          .where(
            and(
              eq(schema.agent.id, issue.assigneeId),
              eq(schema.agent.workspaceId, issue.workspaceId),
            ),
          )
          .limit(1)
        if (!agent) return notFound('Agent not found')

        const startResult = await startIssueRun(appEnv, {
          workspaceId: issue.workspaceId,
          issueId: issue.id,
          agentId: issue.assigneeId,
          source: 'manual',
          actor: { type: 'member', id: access.session.user.id },
        })
        if (startResult.isErr()) return runError(startResult.error)
        return Response.json(startResult.value, { status: 202 })
      },
    },
  },
})
