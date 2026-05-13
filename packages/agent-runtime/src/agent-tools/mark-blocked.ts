import { Result } from 'better-result'
import { tool } from 'ai'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '@garden/db/schema'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunToolContext,
} from './issue-run-tool-context'

export const markBlockedInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(4000),
  })
  .strict()

export function createMarkBlockedTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Mark the issue and current run blocked with one concrete reason.',
    inputSchema: markBlockedInputSchema,
    execute: async ({ reason }) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const db = getIssueRunDb(context.env.DATABASE_URL)
      const commentId = crypto.randomUUID()
      const now = new Date()

      const writeResult = await Result.tryPromise({
        try: async () => {
          await db.transaction(async (tx) => {
            await tx
              .update(schema.issue)
              .set({
                status: 'blocked',
                activeRunId: null,
                updatedAt: now,
              })
              .where(eq(schema.issue.id, run.issueId))
            await tx
              .update(schema.issueRun)
              .set({
                status: 'blocked',
                error: reason,
                resultJson: { resolution: 'mark_blocked', reason },
                finishedAt: now,
                updatedAt: now,
              })
              .where(eq(schema.issueRun.id, run.runId))
            await tx.insert(schema.issueComment).values({
              id: commentId,
              issueId: run.issueId,
              authorType: 'agent',
              authorId: run.agentId,
              body: `Blocked: ${reason}`,
              mentions: null,
            })
          })
        },
        catch: (cause) => dbError('mark issue blocked', cause),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)

      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:blocked',
        stream: 'system',
        level: 'warn',
        message: 'Run blocked',
        payload: { reason, comment_id: commentId },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      context.recordResolution('mark_blocked')
      return toolOkResult({
        comment_id: commentId,
        run_status: 'blocked',
      })
    },
  })
}
