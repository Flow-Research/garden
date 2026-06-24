import { tool } from 'ai'
import { z } from 'zod'
import { issueSourceBindingInsertSchema } from '@garden/db/validation'
import {
  attachSourceBinding,
  type IssueSourceBindingServiceError,
} from '@garden/core/issues/source-binding'
import {
  appendIssueRunEvent,
  IssueRunToolError,
  getIssueRunDb,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunToolContext,
} from './issue-run-tool-context'

export const attachSourceBindingInputSchema = z
  .object({
    connector_id: issueSourceBindingInsertSchema.shape.connectorId,
    source_kind: issueSourceBindingInsertSchema.shape.sourceKind,
    external_id: z.string().trim().min(1).max(4000),
    external_url: z.string().trim().min(1).max(4000).optional(),
  })
  .strict()

function sourceBindingToolError(error: IssueSourceBindingServiceError) {
  const code =
    error.code === 'validation_failed'
      ? 'invalid_input'
      : error.code === 'binding_not_found'
        ? 'not_found'
        : 'database_failed'

  return new IssueRunToolError({
    code,
    message: error.message,
    cause: error,
  })
}

export function createAttachSourceBindingTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Attach this issue to an external source object such as a GitHub PR, Slack thread, Gmail thread, Drive file, or search result.',
    inputSchema: attachSourceBindingInputSchema,
    execute: async (input) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value

      const bindingResult = await attachSourceBinding({
        databaseUrl: context.env.HYPERDRIVE.connectionString,
        workspaceId: run.workspaceId,
        issueId: run.issueId,
        connectorId: input.connector_id,
        sourceKind: input.source_kind,
        externalId: input.external_id,
        externalUrl: input.external_url ?? null,
      })
      if (bindingResult.isErr()) {
        return toolErrorResult(sourceBindingToolError(bindingResult.error))
      }

      const db = getIssueRunDb(context.env.HYPERDRIVE.connectionString)
      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:source_binding_added',
        stream: 'connector',
        message: 'Attached a source binding',
        payload: {
          binding_id: bindingResult.value.binding_id,
          connector_id: input.connector_id,
          source_kind: input.source_kind,
          external_id: input.external_id,
          external_url: input.external_url ?? null,
        },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      return toolOkResult({
        binding_id: bindingResult.value.binding_id,
      })
    },
  })
}
