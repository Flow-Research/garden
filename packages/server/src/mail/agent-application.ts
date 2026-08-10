import {
  AgentId,
  ConversationId,
  DraftId,
  EditableAttachment,
  EditableRecipient,
  MailActor,
  MailAddressId,
  MailboxId,
  MessageId,
  NonNegativeInt,
  RequestDraftDeliveryInput,
  WorkspaceId,
} from '@garden/core/mail'
import { Context, Effect, Layer, Schema } from 'effect'
import {
  MailDraftApplication,
  type MailDraftApplicationError,
} from './draft-application.ts'
import {
  type AccessibleMailbox,
  type ConversationDetail,
  type ConversationSummary,
  type DraftSnapshot,
  MailDraftRevisionConflictError,
  MailRepository,
  type MailRepositoryError,
} from './repository.ts'

export const MailAgentPrincipal = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
  sendExternal: Schema.Literals(['auto', 'manual']),
})
export interface MailAgentPrincipal extends Schema.Schema.Type<
  typeof MailAgentPrincipal
> {}

export const AgentListConversationsInput = Schema.Struct({
  mailboxId: Schema.NullOr(MailboxId),
})
export interface AgentListConversationsInput extends Schema.Schema.Type<
  typeof AgentListConversationsInput
> {}

export const AgentReadConversationInput = Schema.Struct({
  conversationId: ConversationId,
})
export interface AgentReadConversationInput extends Schema.Schema.Type<
  typeof AgentReadConversationInput
> {}

export const AgentCreateDraftInput = Schema.Struct({
  mailboxId: MailboxId,
  fromAddressId: MailAddressId,
  conversationId: Schema.NullOr(ConversationId),
  replyToMessageId: Schema.NullOr(MessageId),
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  recipients: Schema.Array(EditableRecipient),
  attachments: Schema.Array(EditableAttachment),
})
export interface AgentCreateDraftInput extends Schema.Schema.Type<
  typeof AgentCreateDraftInput
> {}

export const AgentSaveDraftInput = Schema.Struct({
  draftId: DraftId,
  expectedRevision: NonNegativeInt,
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  recipients: Schema.Array(EditableRecipient),
  attachments: Schema.Array(EditableAttachment),
})
export interface AgentSaveDraftInput extends Schema.Schema.Type<
  typeof AgentSaveDraftInput
> {}

export const AgentRequestDraftDeliveryInput = Schema.Struct({
  conversationId: ConversationId,
  draftId: DraftId,
  expectedRevision: NonNegativeInt,
})
export interface AgentRequestDraftDeliveryInput extends Schema.Schema.Type<
  typeof AgentRequestDraftDeliveryInput
> {}

/**
 * Workflow dispatch means durable execution began, never that a provider has
 * completed delivery. Manual approval remains pending until a member-attributed
 * application boundary records it.
 */
export const AgentDraftDeliveryRequestOutcome = Schema.TaggedUnion({
  AwaitingApproval: {
    draftId: DraftId,
    conversationId: ConversationId,
    revision: NonNegativeInt,
    externalSendStarted: Schema.Literal(false),
    durableApprovalRequestRecorded: Schema.Literal(true),
    approvalRecorded: Schema.Literal(false),
    deliveryWorkflowDispatched: Schema.Literal(false),
    message: Schema.String,
  },
  DeliveryWorkflowDispatched: {
    draftId: DraftId,
    conversationId: ConversationId,
    revision: NonNegativeInt,
    workflowInstanceId: Schema.String,
    deliveryWorkflowDispatched: Schema.Literal(true),
    externalSendCompleted: Schema.Literal(false),
    message: Schema.String,
  },
})
export type AgentDraftDeliveryRequestOutcome =
  typeof AgentDraftDeliveryRequestOutcome.Type

/** Draft is absent from the actor-authorized conversation projection. */
export class MailAgentDraftUnavailableError extends Schema.TaggedErrorClass<MailAgentDraftUnavailableError>()(
  'MailAgentDraftUnavailableError',
  {
    conversationId: ConversationId,
    draftId: DraftId,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** A viewer may read shared mail but cannot request external delivery. */
export class MailAgentMailboxReadOnlyError extends Schema.TaggedErrorClass<MailAgentMailboxReadOnlyError>()(
  'MailAgentMailboxReadOnlyError',
  {
    mailboxId: MailboxId,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** Durable delivery dispatch failed after authorization was recorded. */
export class MailAgentDeliveryDispatchError extends Schema.TaggedErrorClass<MailAgentDeliveryDispatchError>()(
  'MailAgentDeliveryDispatchError',
  {
    workflowInstanceId: Schema.String,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface MailAgentDeliveryDispatcherService {
  readonly dispatch: (
    input: RequestDraftDeliveryInput,
  ) => Effect.Effect<
    { readonly workflowInstanceId: string },
    MailAgentDeliveryDispatchError
  >
}

/** Infrastructure-neutral durable dispatch port used after draft authorization. */
export class MailAgentDeliveryDispatcher extends Context.Service<
  MailAgentDeliveryDispatcher,
  MailAgentDeliveryDispatcherService
>()('@garden/server/MailAgentDeliveryDispatcher') {}

export type MailAgentApplicationError =
  | MailRepositoryError
  | MailDraftApplicationError
  | MailAgentDraftUnavailableError
  | MailAgentMailboxReadOnlyError
  | MailAgentDeliveryDispatchError

export interface MailAgentApplicationService {
  readonly listMailboxes: () => Effect.Effect<
    ReadonlyArray<AccessibleMailbox>,
    MailRepositoryError
  >
  readonly listConversations: (
    input: AgentListConversationsInput,
  ) => Effect.Effect<ReadonlyArray<ConversationSummary>, MailRepositoryError>
  readonly readConversation: (
    input: AgentReadConversationInput,
  ) => Effect.Effect<ConversationDetail, MailRepositoryError>
  readonly createDraft: (
    input: AgentCreateDraftInput,
  ) => Effect.Effect<DraftSnapshot, MailRepositoryError>
  readonly saveDraft: (
    input: AgentSaveDraftInput,
  ) => Effect.Effect<DraftSnapshot, MailRepositoryError>
  readonly requestDraftDelivery: (
    input: AgentRequestDraftDeliveryInput,
  ) => Effect.Effect<
    AgentDraftDeliveryRequestOutcome,
    MailAgentApplicationError
  >
}

/** Agent-scoped mail authority with no caller-controlled actor or workspace. */
export class MailAgentApplication extends Context.Service<
  MailAgentApplication,
  MailAgentApplicationService
>()('@garden/server/MailAgentApplication') {}

/** Finds the requested draft only inside an already-authorized conversation. */
const requireConversationDraft = (
  detail: ConversationDetail,
  input: AgentRequestDraftDeliveryInput,
): Effect.Effect<DraftSnapshot, MailAgentDraftUnavailableError> => {
  const draft = detail.drafts.find(
    (candidate) => candidate.id === input.draftId,
  )
  return draft === undefined
    ? Effect.fail(
        new MailAgentDraftUnavailableError({
          conversationId: input.conversationId,
          draftId: input.draftId,
          operation: 'requestDraftDelivery.findDraft',
          message: 'Draft is not active in this accessible conversation.',
        }),
      )
    : Effect.succeed(draft)
}
/** Proves the conversation mailbox grants this agent write authority. */
const requireWritableMailbox = (
  mailboxes: ReadonlyArray<AccessibleMailbox>,
  detail: ConversationDetail,
): Effect.Effect<void, MailAgentMailboxReadOnlyError> => {
  const mailbox = mailboxes.find(
    (candidate) => candidate.id === detail.conversation.mailboxId,
  )
  return mailbox === undefined || mailbox.accessLevel === 'viewer'
    ? Effect.fail(
        new MailAgentMailboxReadOnlyError({
          mailboxId: detail.conversation.mailboxId,
          operation: 'requestDraftDelivery.authorize',
          message: 'Agent needs editor or owner access to request delivery.',
        }),
      )
    : Effect.void
}

/**
 * Binds a server-resolved agent principal to Garden Mail. Repository methods
 * remain the sole persistence/access authority; the model never supplies an
 * actor or workspace identifier.
 */
export const makeMailAgentApplicationLayer = (
  principal: MailAgentPrincipal,
): Layer.Layer<
  MailAgentApplication,
  never,
  MailRepository | MailDraftApplication | MailAgentDeliveryDispatcher
> =>
  Layer.effect(
    MailAgentApplication,
    Effect.gen(function* () {
      const repository = yield* MailRepository
      const draftApplication = yield* MailDraftApplication
      const deliveryDispatcher = yield* MailAgentDeliveryDispatcher
      const actor = MailActor.cases.Agent.make({ agentId: principal.agentId })

      return MailAgentApplication.of({
        listMailboxes: Effect.fn('MailAgentApplication.listMailboxes')(
          function* () {
            return yield* repository.listMailboxes({
              workspaceId: principal.workspaceId,
              actor,
            })
          },
        ),
        listConversations: Effect.fn('MailAgentApplication.listConversations')(
          function* (input) {
            return yield* repository.listConversations({
              workspaceId: principal.workspaceId,
              actor,
              mailboxId: input.mailboxId,
            })
          },
        ),
        readConversation: Effect.fn('MailAgentApplication.readConversation')(
          function* (input) {
            return yield* repository.getConversation({
              workspaceId: principal.workspaceId,
              actor,
              conversationId: input.conversationId,
            })
          },
        ),
        createDraft: Effect.fn('MailAgentApplication.createDraft')(
          function* (input) {
            return yield* repository.createDraft({
              ...input,
              workspaceId: principal.workspaceId,
              author: actor,
            })
          },
        ),
        saveDraft: Effect.fn('MailAgentApplication.saveDraft')(
          function* (input) {
            return yield* repository.saveDraft({
              ...input,
              workspaceId: principal.workspaceId,
              actor,
            })
          },
        ),
        requestDraftDelivery: Effect.fn(
          'MailAgentApplication.requestDraftDelivery',
        )(function* (input) {
          const [detail, mailboxes] = yield* Effect.all([
            repository.getConversation({
              workspaceId: principal.workspaceId,
              actor,
              conversationId: input.conversationId,
            }),
            repository.listMailboxes({
              workspaceId: principal.workspaceId,
              actor,
            }),
          ])
          yield* requireWritableMailbox(mailboxes, detail)
          const draft = yield* requireConversationDraft(detail, input)
          if (draft.revision !== input.expectedRevision) {
            return yield* new MailDraftRevisionConflictError({
              draftId: input.draftId,
              expectedRevision: input.expectedRevision,
              actualRevision: draft.revision,
              operation: 'requestDraftDelivery',
              message: 'Draft was changed by another collaborator.',
            })
          }
          if (draft.status === 'awaiting_approval') {
            return AgentDraftDeliveryRequestOutcome.cases.AwaitingApproval.make(
              {
                draftId: draft.id,
                conversationId: input.conversationId,
                revision: draft.revision,
                externalSendStarted: false,
                durableApprovalRequestRecorded: true,
                approvalRecorded: false,
                deliveryWorkflowDispatched: false,
                message:
                  'Human approval is required. Garden has durably recorded the request and has not sent this draft.',
              },
            )
          }
          const authorization = yield* draftApplication.requestDelivery({
            workspaceId: principal.workspaceId,
            draftId: draft.id,
            actor,
            expectedRevision: input.expectedRevision,
            agentApproval: principal.sendExternal,
          })
          if (authorization.waitsForApproval) {
            return AgentDraftDeliveryRequestOutcome.cases.AwaitingApproval.make(
              {
                draftId: authorization.draft.id,
                conversationId: input.conversationId,
                revision: authorization.draft.revision,
                externalSendStarted: false,
                durableApprovalRequestRecorded: true,
                approvalRecorded: false,
                deliveryWorkflowDispatched: false,
                message:
                  'Human approval is required. Garden has durably recorded the request and has not sent this draft.',
              },
            )
          }

          const dispatch = yield* deliveryDispatcher.dispatch({
            workspaceId: principal.workspaceId,
            draftId: authorization.draft.id,
            actor,
            expectedRevision: authorization.draft.revision,
          })
          return AgentDraftDeliveryRequestOutcome.cases.DeliveryWorkflowDispatched.make(
            {
              draftId: authorization.draft.id,
              conversationId: input.conversationId,
              revision: authorization.draft.revision,
              workflowInstanceId: dispatch.workflowInstanceId,
              deliveryWorkflowDispatched: true,
              externalSendCompleted: false,
              message:
                'Garden durably dispatched delivery. Provider completion remains pending.',
            },
          )
        }),
      })
    }),
  )
