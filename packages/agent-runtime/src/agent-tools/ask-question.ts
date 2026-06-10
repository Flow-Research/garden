import { Result } from 'better-result'
import { tool } from 'ai'
import { z } from 'zod'
import type { StructuredQuestion } from '@garden/app-state/chat/structured-input'
import * as schema from '@garden/db/schema'
import { upsertWaitingForInputInbox } from '@garden/db/inbox'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunToolContext,
} from './issue-run-tool-context'
import { eq } from 'drizzle-orm'

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
      const db = getIssueRunDb(context.env.DATABASE_URL)
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
          await db
            .update(schema.issueRun)
            .set({ status: 'waiting_for_input', updatedAt: activityAt })
            .where(eq(schema.issueRun.id, run.runId))
          await upsertWaitingForInputInbox({
            db,
            workspaceId: run.workspaceId,
            issueId: run.issueId,
            runId: run.runId,
            agentId: run.agentId,
            error: question.question,
            activityAt,
          })
        },
        catch: (cause) => dbError('mark issue run waiting for input', cause),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)

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
