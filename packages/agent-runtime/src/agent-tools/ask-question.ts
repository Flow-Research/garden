import { Result } from 'better-result'
import { tool } from 'ai'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import type { StructuredQuestion } from '@garden/app-state/chat/structured-input'
import * as schema from '@garden/db/schema'
import { upsertWaitingForInputInbox } from '@garden/db/inbox'
import { LIVE_RUN_STATUSES } from '@garden/core/issues/run-sync'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  IssueRunToolError,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunToolContext,
} from './issue-run-tool-context'

export const askQuestionInputSchema = z
  .object({
    question: z.string().trim().min(1).max(4000),
    header: z.string().trim().min(1).max(80).optional(),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            description: z.string().trim().min(1).max(500).optional(),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    multiSelect: z.boolean().optional(),
  })
  .strict()

export function createAskQuestionTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Ask one focused blocking question on the issue. Options are optional; a free-text answer is always available in the UI.',
    inputSchema: askQuestionInputSchema,
    execute: async (input) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const db = getIssueRunDb(context.env.HYPERDRIVE.connectionString)
      const question: StructuredQuestion = {
        id: crypto.randomUUID(),
        ...(input.header ? { header: input.header } : {}),
        question: input.question,
        options: input.options ?? [],
        ...(input.multiSelect !== undefined
          ? { multiSelect: input.multiSelect }
          : {}),
      }

      const writeResult = await Result.tryPromise({
        try: async () => {
          const activityAt = new Date()
          const [updatedRun] = await db
            .update(schema.issueRun)
            .set({ status: 'waiting_for_input', updatedAt: activityAt })
            .where(
              and(
                eq(schema.issueRun.id, run.runId),
                inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
              ),
            )
            .returning({ id: schema.issueRun.id })
          if (!updatedRun) return false
          await upsertWaitingForInputInbox({
            db,
            workspaceId: run.workspaceId,
            issueId: run.issueId,
            runId: run.runId,
            agentId: run.agentId,
            error: question.question,
            activityAt,
          })
          return true
        },
        catch: (cause) => dbError('mark issue run waiting for input', cause),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)
      if (!writeResult.value) {
        return toolErrorResult(
          new IssueRunToolError({
            code: 'invalid_state',
            message: 'Issue run is no longer active.',
          }),
        )
      }

      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:input_requested',
        stream: 'agent',
        level: 'warn',
        message: question.question,
        payload: question,
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      context.recordResolution('ask_question')
      return toolOkResult({
        question_id: question.id,
        question,
        run_status: 'waiting_for_input',
      })
    },
  })
}
