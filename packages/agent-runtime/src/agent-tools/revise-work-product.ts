import { Result } from 'better-result'
import { tool } from 'ai'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '@garden/db/schema'
import { upsertWorkProductReviewInbox } from '@garden/db/inbox'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  IssueRunToolError,
  previousVersionsCount,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  updateRunStatus,
  type IssueRunToolContext,
} from './issue-run-tool-context'

export const reviseWorkProductInputSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(240).optional(),
    body: z.string().trim().min(1).max(200_000),
    change_summary: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()

export function createReviseWorkProductTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Revise an existing issue work product in place. The old body is stored in payload.previous_versions.',
    inputSchema: reviseWorkProductInputSchema,
    execute: async (input) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const db = getIssueRunDb(context.env.HYPERDRIVE.connectionString)
      const now = new Date()

      const writeResult = await Result.tryPromise({
        try: async () => {
          const [existing] = await db
            .select()
            .from(schema.issueWorkProduct)
            .where(
              and(
                eq(schema.issueWorkProduct.id, input.id),
                eq(schema.issueWorkProduct.workspaceId, run.workspaceId),
                eq(schema.issueWorkProduct.issueId, run.issueId),
              ),
            )
            .limit(1)
          if (!existing) return null

          const [updated] = await db
            .update(schema.issueWorkProduct)
            .set({
              title: input.title ?? existing.title,
              body: input.body,
              runId: run.runId,
              agentId: run.agentId,
              status: 'review',
              reviewState: 'pending',
              payload: sql`
                jsonb_set(
                  coalesce(${schema.issueWorkProduct.payload}, '{}'::jsonb),
                  '{previous_versions}',
                  coalesce(${schema.issueWorkProduct.payload}->'previous_versions', '[]'::jsonb) ||
                    jsonb_build_array(jsonb_build_object(
                      'body', ${existing.body ?? ''},
                      'title', ${existing.title ?? ''},
                      'replaced_at', ${now.toISOString()},
                      'agent_id', ${run.agentId},
                      'change_summary', ${input.change_summary ?? null}
                    )),
                  true
                )
              ` as never,
              updatedAt: now,
            })
            .where(eq(schema.issueWorkProduct.id, input.id))
            .returning()
          if (updated) {
            await db
              .update(schema.issue)
              .set({
                status: 'in_review',
                updatedAt: now,
              })
              .where(
                and(
                  eq(schema.issue.id, run.issueId),
                  sql`${schema.issue.status} not in ('done', 'cancelled')`,
                ),
              )
            await upsertWorkProductReviewInbox({
              db,
              workspaceId: run.workspaceId,
              workProductId: updated.id,
            })
          }
          return updated ?? null
        },
        catch: (cause) => dbError('revise issue work product', cause),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)
      if (!writeResult.value) {
        return toolErrorResult(
          new IssueRunToolError({
            code: 'not_found',
            message: 'Work product not found.',
          }),
        )
      }

      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:work_product_created',
        stream: 'agent',
        message: 'Revised a work product',
        payload: {
          revised: true,
          work_product_id: input.id,
          title: writeResult.value.title ?? input.title ?? 'Work product',
          previous_versions_count: previousVersionsCount(
            writeResult.value.payload,
          ),
          change_summary: input.change_summary ?? null,
        },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      const statusResult = await updateRunStatus({
        db,
        run,
        status: 'succeeded',
        finished: true,
        resultJson: {
          resolution: 'revise_work_product',
          work_product_id: input.id,
        },
      })
      if (statusResult.isErr()) return toolErrorResult(statusResult.error)

      const succeededEventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:succeeded',
        stream: 'system',
        message: 'Run succeeded',
        payload: { resolution: 'revise_work_product' },
      })
      if (succeededEventResult.isErr())
        return toolErrorResult(succeededEventResult.error)

      context.captureAnalytics(GARDEN_ANALYTICS_EVENTS.workProductSubmitted, {
        work_product_id: input.id,
        title: input.title ?? writeResult.value.title,
        body: input.body,
        change_summary: input.change_summary,
        previous_versions_count: previousVersionsCount(
          writeResult.value.payload,
        ),
        revised: true,
        review_state: 'pending',
      })
      context.recordResolution('revise_work_product')
      return toolOkResult({
        work_product_id: input.id,
        previous_versions_count: previousVersionsCount(
          writeResult.value.payload,
        ),
        run_status: 'succeeded',
      })
    },
  })
}
