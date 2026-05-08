import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import {
  listIssueRuns,
  startIssueRun,
  type IssueRunServiceError,
} from '@garden/core/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/runs')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(request, issue.workspaceId)
        if (access instanceof Response) return access

        const runsResult = await listIssueRuns({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runsResult.isErr()) return runError(runsResult.error)
        return Response.json(runsResult.value)
      },
      POST: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [issue] = await db
          .select({
            id: schema.issue.id,
            workspaceId: schema.issue.workspaceId,
            assigneeType: schema.issue.assigneeType,
            assigneeId: schema.issue.assigneeId,
          })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(request, issue.workspaceId)
        if (access instanceof Response) return access

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
