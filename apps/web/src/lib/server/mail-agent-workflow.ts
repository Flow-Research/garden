import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  AgentId,
  ConversationId,
  MailboxId,
  WorkspaceId,
} from '@garden/core/mail'
import type { MailAgentConversationTriggerValue } from '@garden/agent-runtime'
import type { AppEnv } from './env'
import { createRequestDbProvider, type Db } from './db'
import { triggerAssignedMailAgentNow } from './mail-agent-orchestration'
import {
  MailAgentDispatchParams,
  MailAgentOrchestrationError,
  dispatchAssignedMailAgent,
  type MailAgentWorkflowBinding,
} from './mail-agent-workflow-dispatch'
import { schema } from './db'

export const MailAgentWorkflowParams = MailAgentDispatchParams
export type MailAgentWorkflowParams = MailAgentDispatchParams

export type MailAgentWorkflowResult = {
  readonly status: string
}

/** Runs one agent trigger checkpoint with an isolate-local Hyperdrive client. */
const runAgentTriggerStep = (
  env: AppEnv,
  params: MailAgentWorkflowParams,
): Promise<MailAgentWorkflowResult> => {
  const provider = createRequestDbProvider(env)
  const trigger: MailAgentConversationTriggerValue = {
    workspaceId: params.workspaceId,
    mailboxId: params.mailboxId,
    conversationId: params.conversationId,
    eventId: params.eventId,
    reason: params.reason,
  }
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => provider.db(),
        catch: (cause) =>
          new MailAgentOrchestrationError({
            operation: 'workflow.database.connect',
            message: 'Garden could not connect for the mail agent Workflow.',
            cause,
          }),
      }),
      (db) =>
        triggerAssignedMailAgentNow(db, env, params, trigger).pipe(
          Effect.map((result) => ({ status: result.status })),
        ),
      () => Effect.promise(() => provider.close()),
    ),
  )
}

/** Durable boundary for an assignment-owned server-driven Think turn. */
export class MailAgentWorkflow extends WorkflowEntrypoint<
  AppEnv,
  MailAgentWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<MailAgentWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<MailAgentWorkflowResult> {
    return await step.do('trigger-draft-turn', () =>
      runAgentTriggerStep(this.env, event.payload),
    )
  }
}

/** Dispatches new inbound mail only to agents already assigned to its thread. */
export const dispatchInboundMailAgents = Effect.fn('MailAgent.dispatchInbound')(
  function* (
    db: Db,
    binding: MailAgentWorkflowBinding,
    input: {
      readonly conversationIds: ReadonlyArray<typeof ConversationId.Type>
      readonly eventId: string
    },
  ) {
    if (input.conversationIds.length === 0) return []
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            agentId: schema.agent.id,
            ownerUserId: schema.agent.ownerUserId,
            conversationId: schema.mailConversation.id,
            mailboxId: schema.mailConversation.mailboxId,
            workspaceId: schema.mailConversation.workspaceId,
          })
          .from(schema.mailConversation)
          .innerJoin(
            schema.mailConversationAssignment,
            and(
              eq(
                schema.mailConversationAssignment.conversationId,
                schema.mailConversation.id,
              ),
              eq(schema.mailConversationAssignment.assigneeType, 'agent'),
              isNull(schema.mailConversationAssignment.unassignedAt),
            ),
          )
          .innerJoin(
            schema.agent,
            and(
              eq(
                schema.agent.id,
                schema.mailConversationAssignment.assigneeAgentId,
              ),
              eq(schema.agent.status, 'active'),
            ),
          )
          .innerJoin(
            schema.mailMailboxAccess,
            and(
              eq(
                schema.mailMailboxAccess.mailboxId,
                schema.mailConversation.mailboxId,
              ),
              eq(schema.mailMailboxAccess.actorType, 'agent'),
              eq(schema.mailMailboxAccess.agentId, schema.agent.id),
            ),
          )
          .where(
            inArray(schema.mailConversation.id, [...input.conversationIds]),
          ),
      catch: (cause) =>
        new MailAgentOrchestrationError({
          operation: 'dispatchInbound.selectAssignments',
          message: 'Garden could not resolve inbound mail assignments.',
          cause,
        }),
    })

    return yield* Effect.forEach(
      rows,
      (row) =>
        dispatchAssignedMailAgent(
          binding,
          MailAgentWorkflowParams.make({
            workspaceId: WorkspaceId.make(row.workspaceId),
            ownerUserId: row.ownerUserId,
            agentId: AgentId.make(row.agentId),
            mailboxId: MailboxId.make(row.mailboxId),
            conversationId: ConversationId.make(row.conversationId),
            eventId: input.eventId,
            reason: 'inbound',
          }),
        ),
      { concurrency: 4 },
    )
  },
)

export { dispatchAssignedMailAgent }
export type { MailAgentWorkflowBinding }
