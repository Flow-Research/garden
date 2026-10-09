import { Result } from 'better-result'
import { tool } from 'ai'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { connectorRegistry, getConnectorById } from '@garden/connectors'
import { upsertConnectorNeededInbox } from '@garden/db/inbox'
import * as schema from '@garden/db/schema'
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

const knownConnectorIds = connectorRegistry.map((c) => c.id).join(', ')

export const markBlockedInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(4000),
    connector_id: z.string().trim().min(1).max(60).optional(),
  })
  .strict()

export function createMarkBlockedTool(context: IssueRunToolContext) {
  return tool({
    description: `Mark the issue and current run blocked with one concrete reason. When the block is because a required connector is missing, pass connector_id from the known connector ids: ${knownConnectorIds}.`,
    inputSchema: markBlockedInputSchema,
    execute: async ({ reason, connector_id }) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value
      const connector = connector_id
        ? getConnectorById(connector_id)
        : undefined
      if (connector_id && !connector) {
        return toolErrorResult(
          new IssueRunToolError({
            code: 'invalid_input',
            message: `Unknown connector id "${connector_id}". Valid ids: ${knownConnectorIds}.`,
          }),
        )
      }
      const db = getIssueRunDb(context.env.HYPERDRIVE.connectionString)
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
                resultJson: {
                  resolution: 'mark_blocked',
                  reason,
                  ...(connector_id ? { connector_id } : {}),
                },
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
        payload: {
          reason,
          comment_id: commentId,
          ...(connector_id ? { connector_id } : {}),
        },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      if (connector_id && connector) {
        const inboxResult = await Result.tryPromise({
          try: () =>
            upsertConnectorNeededInbox({
              db,
              workspaceId: run.workspaceId,
              issueId: run.issueId,
              connectorId: connector_id,
              connectorLabel: connector.label,
              reason,
              runId: run.runId,
              agentId: run.agentId,
            }),
          catch: (cause) => dbError('write connector needed inbox', cause),
        })
        if (inboxResult.isErr()) {
          console.warn(
            '[agent-runtime] failed to write connector-needed inbox item',
            { error: inboxResult.error },
          )
        }
      }

      context.recordResolution('mark_blocked')
      return toolOkResult({
        comment_id: commentId,
        run_status: 'blocked',
      })
    },
  })
}
