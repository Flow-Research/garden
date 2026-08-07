import { and, eq } from 'drizzle-orm'
import { getAgentByName } from 'agents'
import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import { disposeRpcResult } from '@garden/app-state/platform/rpc'

const AGENT_ROUTING_RETRY = { maxAttempts: 3 }

type IssueRunPlan = Array<{
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}>

type IssueRunPlanAgentStub = {
  getRunPlan(input: {
    runId: string
    issueId: string
  }): Promise<IssueRunPlan | null>
}

/**
 * Narrows the generated Agent namespace to the internal RPC used by this
 * development-only route. Project-reference declarations intentionally keep
 * the Worker binding generic so server modules do not depend on the concrete
 * Agent runtime implementation.
 */
async function getIssueRunPlanAgent(hostName: string) {
  return (await getAgentByName(appEnv.AgentDO, hostName, {
    routingRetry: AGENT_ROUTING_RETRY,
  })) as unknown as IssueRunPlanAgentStub
}

export const Route = createFileRoute('/api/dev/issue-run-plan')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {

        const appContext = requireAppRequestContext(context)
        if (appEnv.ENVIRONMENT === 'production') {
          return notFound('Not found')
        }

        const url = new URL(request.url)
        const runId = url.searchParams.get('runId')?.trim()
        if (!runId) return badRequest('Missing runId')

        const db = await appContext.db()
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

        const access = await requireWorkspaceAccess(appContext, run.workspaceId)
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

        const planResult = await Result.tryPromise({
          try: async () => {
            const stub = await getIssueRunPlanAgent(run.hostName)
            return disposeRpcResult(
              await stub.getRunPlan({
                runId: run.id,
                issueId: run.issueId as string,
              }),
            )
          },
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
