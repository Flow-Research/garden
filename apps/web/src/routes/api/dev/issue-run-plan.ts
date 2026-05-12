import { and, eq } from 'drizzle-orm'
import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import { getAgentDoStub } from '@/lib/server/agent-do-router'

export const Route = createFileRoute('/api/dev/issue-run-plan')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (appEnv.ENVIRONMENT === 'production') {
          return notFound('Not found')
        }

        const url = new URL(request.url)
        const runId = url.searchParams.get('runId')?.trim()
        if (!runId) return badRequest('Missing runId')

        const db = getDb(appEnv)
        const [run] = await db
          .select({
            id: schema.issueRun.id,
            workspaceId: schema.issueRun.workspaceId,
            issueId: schema.issueRun.issueId,
            hostName: schema.issueRun.hostName,
          })
          .from(schema.issueRun)
          .where(eq(schema.issueRun.id, runId))
          .limit(1)
        if (!run) return notFound('Issue run not found')
        if (!run.issueId) return badRequest('Issue run has no issue')

        const access = await requireWorkspaceAccess(request, run.workspaceId)
        if (access instanceof Response) return access

        const issueAccess = await db
          .select({ id: schema.issue.id })
          .from(schema.issue)
          .where(
            and(
              eq(schema.issue.id, run.issueId),
              eq(schema.issue.workspaceId, run.workspaceId),
            ),
          )
          .limit(1)
        if (!issueAccess[0]) return notFound('Issue not found')

        const stubResult = getAgentDoStub(appEnv, run.hostName)
        if (stubResult.isErr()) return badRequest(stubResult.error.message)

        const planResult = await Result.tryPromise({
          try: async () =>
            await stubResult.value.getRunPlan({
              runId: run.id,
              issueId: run.issueId as string,
            }),
          catch: (cause) =>
            cause instanceof Error ? cause.message : String(cause),
        })
        if (planResult.isErr()) {
          return badRequest(
            `Failed to read issue run plan: ${planResult.error}`,
          )
        }

        return Response.json({
          run_id: run.id,
          issue_id: run.issueId,
          plan: planResult.value,
        })
      },
    },
  },
})
