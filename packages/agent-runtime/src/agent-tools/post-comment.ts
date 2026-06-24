import { Result } from 'better-result'
import { tool } from 'ai'
import { z } from 'zod'
import {
  appendIssueRunEvent,
  dbError,
  getIssueRunDb,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunToolContext,
} from './issue-run-tool-context'
import * as schema from '@garden/db/schema'
import { upsertAgentCommentInbox } from '@garden/db/inbox'

export const postCommentInputSchema = z
  .object({
    body: z.string().trim().min(1).max(20_000),
  })
  .strict()

export function createPostCommentTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Post a short non-blocking comment to the issue. Does not satisfy the run exit-state guard.',
    inputSchema: postCommentInputSchema,
    execute: async ({ body }) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const db = getIssueRunDb(context.env.HYPERDRIVE.connectionString)
      const commentId = crypto.randomUUID()

      const writeResult = await Result.tryPromise({
        try: async () => {
          const createdAt = new Date()
          await db.insert(schema.issueComment).values({
            id: commentId,
            issueId: run.issueId,
            authorType: 'agent',
            authorId: run.agentId,
            body,
            mentions: null,
            createdAt,
          })
          await upsertAgentCommentInbox({
            db,
            workspaceId: run.workspaceId,
            issueId: run.issueId,
            commentId,
            agentId: run.agentId,
            body,
            createdAt,
          })
        },
        catch: (cause) => dbError('post issue comment', cause),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)

      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:message',
        stream: 'agent',
        message: 'Posted a comment',
        payload: { comment_id: commentId },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      return toolOkResult({ comment_id: commentId })
    },
  })
}
