import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  listIssueRuns,
  startIssueRun,
} from '@garden/server/issues/run-service'

export const Route = createFileRoute('/api/issues/$id/runs')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          appContext,
          issue.workspaceId,
        )
        if (access instanceof Response) return access

        const runsResult = await listIssueRuns({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (runsResult.isErr()) return serviceErrorResponse(runsResult.error)
        return Response.json(runsResult.value)
      },
      POST: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
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

        const access = await requireWorkspaceAccess(
          appContext,
          issue.workspaceId,
        )
        if (access instanceof Response) return access
        const permission = await requireWorkspacePermission({
          appContext,
          request: appContext.request,
          workspaceId: issue.workspaceId,
          permissions: workspacePermissions.issueManage,
        })
        if (permission) return permission

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
        if (startResult.isErr()) return serviceErrorResponse(startResult.error)
        return Response.json(startResult.value, { status: 202 })
      },
    },
  },
})
