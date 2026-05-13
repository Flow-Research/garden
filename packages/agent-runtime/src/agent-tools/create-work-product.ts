import { Result } from 'better-result'
import { tool } from 'ai'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  issueWorkProductTypeSchema,
} from '@garden/db/validation'
import * as schema from '@garden/db/schema'
import { upsertWorkProductReviewInbox } from '@garden/db/inbox'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  updateRunStatus,
  type IssueRunToolContext,
} from './issue-run-tool-context'

export const createWorkProductInputSchema = z
  .object({
    type: issueWorkProductTypeSchema,
    title: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(200_000),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export function createCreateWorkProductTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Create a persistent issue work product: brief, plan, connector reply, pull request, report, or checklist.',
    inputSchema: createWorkProductInputSchema,
    execute: async (input) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const db = getIssueRunDb(context.env.DATABASE_URL)
      const workProductId = crypto.randomUUID()

      const writeResult = await Result.tryPromise({
        try: async () => {
          await db.transaction(async (tx) => {
            await tx
              .update(schema.issueWorkProduct)
              .set({ isPrimary: false, updatedAt: new Date() })
              .where(
                and(
                  eq(schema.issueWorkProduct.issueId, run.issueId),
                  eq(schema.issueWorkProduct.type, input.type),
                ),
              )
            await tx.insert(schema.issueWorkProduct).values({
              id: workProductId,
              workspaceId: run.workspaceId,
              issueId: run.issueId,
              runId: run.runId,
              agentId: run.agentId,
              type: input.type,
              status: 'review',
              reviewState: 'pending',
              isPrimary: true,
              title: input.title,
              body: input.body,
              payload: input.payload ?? null,
            })
            await tx
              .update(schema.issue)
              .set({
                status: 'in_review',
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.issue.id, run.issueId),
                  sql`${schema.issue.status} not in ('done', 'cancelled')`,
                ),
              )
          })
          await upsertWorkProductReviewInbox({
            db,
            workspaceId: run.workspaceId,
            workProductId,
          })
        },
        catch: (cause) => dbError('create issue work product', cause),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)

      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:work_product_created',
        stream: 'agent',
        message: 'Created a work product',
        payload: {
          type: input.type,
          title: input.title,
          work_product_id: workProductId,
        },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      const statusResult = await updateRunStatus({
        db,
        run,
        status: 'succeeded',
        finished: true,
        resultJson: {
          resolution: 'create_work_product',
          work_product_id: workProductId,
        },
      })
      if (statusResult.isErr()) return toolErrorResult(statusResult.error)

      const succeededEventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:succeeded',
        stream: 'system',
        message: 'Run succeeded',
        payload: { resolution: 'create_work_product' },
      })
      if (succeededEventResult.isErr())
        return toolErrorResult(succeededEventResult.error)

      context.recordResolution('create_work_product')
      return toolOkResult({
        work_product_id: workProductId,
        run_status: 'succeeded',
      })
    },
  })
}
