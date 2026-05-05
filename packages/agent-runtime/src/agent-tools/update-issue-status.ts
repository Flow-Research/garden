import { Result } from 'better-result'
import { tool } from 'ai'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { canAgentSelfManageIssueStatus } from '@garden/core/issues/run-sync'
import type { IssueStatus } from '@garden/core/types/issue'
import * as schema from '@garden/db/schema'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  IssueRunToolError,
  type IssueRunToolContext,
} from './issue-run-tool-context'

export const updateIssueStatusInputSchema = z
  .object({
    status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'blocked']),
  })
  .strict()

export function createUpdateIssueStatusTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Move your assigned issue status as your work advances. Use mark_blocked when blocked should also close the run.',
    inputSchema: updateIssueStatusInputSchema,
    execute: async ({ status }) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const nextStatus = status as IssueStatus

      if (!canAgentSelfManageIssueStatus(nextStatus)) {
        return toolErrorResult(
          new IssueRunToolError({
            code: 'invalid_input',
            message:
              'Agents can only self-manage todo, in_progress, in_review, done, or blocked.',
          }),
        )
      }

      const db = getIssueRunDb(context.env.DATABASE_URL)
      const now = new Date()
      const writeResult = await Result.tryPromise({
        try: async () => {
          const [issue] = await db
            .select({
              id: schema.issue.id,
              status: schema.issue.status,
              activeRunId: schema.issue.activeRunId,
              assigneeType: schema.issue.assigneeType,
              assigneeId: schema.issue.assigneeId,
            })
            .from(schema.issue)
            .where(
              and(
                eq(schema.issue.id, run.issueId),
                eq(schema.issue.workspaceId, run.workspaceId),
              ),
            )
            .limit(1)

          if (!issue) {
            return Result.err(
              new IssueRunToolError({
                code: 'not_found',
                message: 'Issue not found.',
              }),
            )
          }

          if (
            issue.assigneeType !== 'agent' ||
            issue.assigneeId !== run.agentId
          ) {
            return Result.err(
              new IssueRunToolError({
                code: 'invalid_state',
                message:
                  'Only the assigned agent can self-manage this issue status.',
              }),
            )
          }

          if (issue.activeRunId !== run.runId) {
            return Result.err(
              new IssueRunToolError({
                code: 'invalid_state',
                message:
                  'Only the active run can self-manage this issue status.',
              }),
            )
          }

          if (issue.status === 'cancelled') {
            return Result.err(
              new IssueRunToolError({
                code: 'invalid_state',
                message: 'Cancelled issues cannot be self-managed by agents.',
              }),
            )
          }

          await db
            .update(schema.issue)
            .set({ status: nextStatus, updatedAt: now })
            .where(eq(schema.issue.id, run.issueId))

          return Result.ok({
            previousStatus: (issue.status ?? 'backlog') as IssueStatus,
          })
        },
        catch: (cause) => dbError('update issue status', cause),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)
      if (writeResult.value.isErr()) {
        return toolErrorResult(writeResult.value.error)
      }

      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:message',
        stream: 'tool',
        message: 'Issue status updated',
        payload: {
          previous_status: writeResult.value.value.previousStatus,
          next_status: nextStatus,
        },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      return toolOkResult({
        issue_status: nextStatus,
        previous_status: writeResult.value.value.previousStatus,
      })
    },
  })
}
