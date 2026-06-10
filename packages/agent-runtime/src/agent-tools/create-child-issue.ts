import { Result, type Result as ResultValue } from 'better-result'
import { tool } from 'ai'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '@garden/db/schema'
import { createIssue as createIssueService } from '@garden/server/issues/server'
import { startIssueRun } from '@garden/server/issues/run-service'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  IssueRunToolError,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunDb,
  type IssueRunToolContext,
} from './issue-run-tool-context'

const MAX_CHILD_DEPTH = 5
const SOFT_WARN_DEPTH = 3

export const createChildIssueInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(50_000),
    assignee_agent_id: z.string().uuid().optional(),
  })
  .strict()

async function loadIssueDepth(args: {
  db: IssueRunDb
  issueId: string
}): Promise<ResultValue<number, IssueRunToolError>> {
  const result = await Result.tryPromise({
    try: async () => {
      let depth = 0
      let nextIssueId: string | null = args.issueId
      while (nextIssueId && depth <= MAX_CHILD_DEPTH) {
        const [issue] = await args.db
          .select({ parentId: schema.issue.parentId })
          .from(schema.issue)
          .where(eq(schema.issue.id, nextIssueId))
          .limit(1)
        nextIssueId = issue?.parentId ?? null
        if (nextIssueId) depth += 1
      }
      return depth
    },
    catch: (cause) => dbError('load issue depth', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

export function createCreateChildIssueTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Create a child issue for work that needs its own owner or conversation. Optional assignee_agent_id starts that child immediately.',
    inputSchema: createChildIssueInputSchema,
    execute: async (input) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const db = getIssueRunDb(context.env.DATABASE_URL)

      const depthResult = await loadIssueDepth({ db, issueId: run.issueId })
      if (depthResult.isErr()) return toolErrorResult(depthResult.error)
      if (depthResult.value >= MAX_CHILD_DEPTH) {
        return toolErrorResult(
          new IssueRunToolError({
            code: 'invalid_state',
            message: `Child issue depth limit reached at depth ${depthResult.value}.`,
          }),
        )
      }

      const issueResult = await createIssueService({
        databaseUrl: context.env.DATABASE_URL,
        workspaceId: run.workspaceId,
        title: input.title,
        description: input.description,
        status: 'todo',
        priority: 'medium',
        createdBy: run.agentOwnerUserId,
        assigneeType: input.assignee_agent_id ? 'agent' : null,
        assigneeId: input.assignee_agent_id ?? null,
        parentId: run.issueId,
      })
      if (issueResult.isErr()) {
        return toolErrorResult(
          new IssueRunToolError({
            code: 'database_failed',
            message: issueResult.error.message,
            cause: issueResult.error,
          }),
        )
      }

      const childIssue = issueResult.value
      let childRun:
        | { kind: 'not_started' }
        | { kind: 'started'; run_id: string }
        | { kind: 'failed'; error: string } = { kind: 'not_started' }

      if (input.assignee_agent_id) {
        const startResult = await startIssueRun(context.env, {
          workspaceId: run.workspaceId,
          issueId: childIssue.id,
          agentId: input.assignee_agent_id,
          source: 'manual',
          trigger: { correlationId: `parent:${run.issueId}:run:${run.runId}` },
          actor: { type: 'agent', id: run.agentId },
        })
        childRun = startResult.isOk() && startResult.value.kind === 'started'
          ? { kind: 'started', run_id: startResult.value.runId }
          : {
              kind: 'failed',
              error: startResult.isErr()
                ? startResult.error.message
                : startResult.value.kind,
            }
      }

      const warning =
        depthResult.value >= SOFT_WARN_DEPTH
          ? `Parent issue is already at depth ${depthResult.value}. Prefer a checklist unless this child needs a separate owner.`
          : null

      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:message',
        stream: 'agent',
        level: warning ? 'warn' : 'info',
        message: 'Created a child issue',
        payload: {
          child_issue_id: childIssue.id,
          child_identifier: childIssue.identifier,
          child_run: childRun,
          warning,
        },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      context.recordResolution('create_child_issue')
      return toolOkResult({
        issue_id: childIssue.id,
        identifier: childIssue.identifier,
        child_run: childRun,
        warning,
        run_status: 'running',
      })
    },
  })
}
