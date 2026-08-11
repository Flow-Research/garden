import { Effect, Schema } from 'effect'
import {
  AgentId,
  ConversationId,
  MailboxId,
  WorkspaceId,
} from '@garden/core/mail'

export const MailAgentDispatchParams = Schema.Struct({
  workspaceId: WorkspaceId,
  ownerUserId: Schema.String.check(Schema.isUUID()),
  conversationId: ConversationId,
  agentId: AgentId,
  mailboxId: MailboxId,
  eventId: Schema.String.check(Schema.isUUID()),
  reason: Schema.Literals(['assignment', 'inbound']),
})
export interface MailAgentDispatchParams extends Schema.Schema.Type<
  typeof MailAgentDispatchParams
> {}

/** Mail-agent orchestration could not authorize, persist, or reach its runtime. */
export class MailAgentOrchestrationError extends Schema.TaggedErrorClass<MailAgentOrchestrationError>()(
  'MailAgentOrchestrationError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface MailAgentWorkflowBinding {
  readonly create: (options: {
    readonly id: string
    readonly params: MailAgentDispatchParams
  }) => Promise<unknown>
  readonly get: (id: string) => Promise<unknown>
}

/**
 * Starts one deterministic Workflow or returns its already-created instance.
 * The event UUID already uniquely identifies an assignment or inbound message;
 * using it alone keeps the instance ID under Cloudflare's 100-character limit.
 * Source: https://developers.cloudflare.com/workflows/reference/limits/
 */
export const dispatchAssignedMailAgent = Effect.fn(
  'MailAgent.dispatchWorkflow',
)(function* (
  binding: MailAgentWorkflowBinding,
  params: MailAgentDispatchParams,
) {
  const workflowId = `mail-agent-${params.eventId}`
  yield* Effect.tryPromise({
    try: () => binding.create({ id: workflowId, params }),
    catch: (cause) =>
      new MailAgentOrchestrationError({
        operation: 'dispatchWorkflow.create',
        message: 'Garden could not dispatch the mail agent Workflow.',
        cause,
      }),
  }).pipe(
    Effect.catchTag('MailAgentOrchestrationError', (createError) =>
      Effect.tryPromise({
        try: () => binding.get(workflowId),
        catch: () => createError,
      }),
    ),
  )
  return { workflowId }
})
