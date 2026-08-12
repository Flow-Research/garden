import {
  AssignConversationInput,
  AttachmentDisposition,
  AttachmentId,
  ConversationId,
  CreateDraftInput,
  DraftId,
  DraftSender,
  DraftStatus,
  DeliveryAttemptId,
  EditableAttachment,
  EditableRecipient,
  EnvelopeReplyTo,
  EmailAddress,
  InboundMailEnvelope,
  ImportedMailEnvelope,
  IngestedMail,
  MailActionActor,
  MailActor,
  MailAddressId,
  MailAddressKind,
  MailDomainId,
  MailboxAccessLevel,
  MailboxId,
  MailboxKind,
  MailboxOrigin,
  MailboxSendCapability,
  MailSyncAccount,
  MailSyncItem,
  MailSyncRun,
  ResolveMailSyncAccountInput,
  ListPersonalMailSyncStatesInput,
  PersonalMailSyncState,
  StartMailSyncRunInput,
  PersistMailSyncPageInput,
  FinalizeMailSyncEnumerationInput,
  ClaimPendingMailSyncBatchInput,
  SettleMailSyncItemInput,
  CompleteMailSyncRunInput,
  FailMailSyncRunInput,
  MessageAuthor,
  MessageId,
  MessageSource,
  NonEmptyString,
  NonNegativeInt,
  PositiveInt,
  ProviderKey,
  ProviderObjectId,
  RecipientKind,
  RecordDeliveryOutcomeInput,
  SaveDraftInput,
  TransitionDraftInput,
  Sha256,
  StorageKey,
  UnassignConversationInput,
  UpdateConversationStateInput,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import { Context, Effect, Schema } from 'effect'
import { MailTransportRoute } from '../model.ts'

export const ListMailboxesInput = Schema.Struct({
  workspaceId: WorkspaceId,
  actor: MailActor,
})
export interface ListMailboxesInput extends Schema.Schema.Type<
  typeof ListMailboxesInput
> {}

export const ListConversationsInput = Schema.Struct({
  workspaceId: WorkspaceId,
  actor: MailActor,
  mailboxId: Schema.NullOr(MailboxId),
})
export interface ListConversationsInput extends Schema.Schema.Type<
  typeof ListConversationsInput
> {}

/** Opaque keyset position for the descending conversation activity order. */
export const MailConversationCursor = Schema.Struct({
  activityAt: UtcTimestamp,
  conversationId: ConversationId,
})
export interface MailConversationCursor extends Schema.Schema.Type<
  typeof MailConversationCursor
> {}

export const ListConversationPageInput = Schema.Struct({
  workspaceId: WorkspaceId,
  actor: MailActor,
  mailboxId: Schema.NullOr(MailboxId),
  cursor: Schema.NullOr(MailConversationCursor),
  query: Schema.String,
  unreadOnly: Schema.Boolean,
  limit: PositiveInt,
})
export interface ListConversationPageInput extends Schema.Schema.Type<
  typeof ListConversationPageInput
> {}

export const GetConversationInput = Schema.Struct({
  workspaceId: WorkspaceId,
  actor: MailActor,
  conversationId: ConversationId,
})
export interface GetConversationInput extends Schema.Schema.Type<
  typeof GetConversationInput
> {}

export const GetDraftInput = Schema.Struct({
  workspaceId: WorkspaceId,
  actor: MailActor,
  draftId: DraftId,
})
export interface GetDraftInput extends Schema.Schema.Type<
  typeof GetDraftInput
> {}

export const GetRawMessageContentRefInput = Schema.Struct({
  workspaceId: WorkspaceId,
  actor: MailActor,
  conversationId: ConversationId,
  messageId: MessageId,
})
export interface GetRawMessageContentRefInput extends Schema.Schema.Type<
  typeof GetRawMessageContentRefInput
> {}

export const GetAttachmentContentRefInput = Schema.Struct({
  workspaceId: WorkspaceId,
  actor: MailActor,
  conversationId: ConversationId,
  messageId: MessageId,
  attachmentId: AttachmentId,
})
export interface GetAttachmentContentRefInput extends Schema.Schema.Type<
  typeof GetAttachmentContentRefInput
> {}

export const ResolveLocalAddressInput = Schema.Struct({
  address: EmailAddress,
})
export interface ResolveLocalAddressInput extends Schema.Schema.Type<
  typeof ResolveLocalAddressInput
> {}

export const AccessibleMailbox = Schema.Struct({
  id: MailboxId,
  workspaceId: WorkspaceId,
  name: NonEmptyString,
  kind: MailboxKind,
  accessLevel: MailboxAccessLevel,
  origin: MailboxOrigin,
  primaryAddress: Schema.NullOr(EmailAddress),
  externalAddress: Schema.NullOr(EmailAddress),
  sendCapability: MailboxSendCapability,
})
export interface AccessibleMailbox extends Schema.Schema.Type<
  typeof AccessibleMailbox
> {}

export const ConversationActorState = Schema.Struct({
  lastReadMessageId: Schema.NullOr(MessageId),
  readAt: Schema.NullOr(UtcTimestamp),
  archivedAt: Schema.NullOr(UtcTimestamp),
  mutedAt: Schema.NullOr(UtcTimestamp),
  pinned: Schema.Boolean,
})
export interface ConversationActorState extends Schema.Schema.Type<
  typeof ConversationActorState
> {}

export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  mailboxId: MailboxId,
  subject: Schema.String,
  lastMessageAt: Schema.NullOr(UtcTimestamp),
  lastSenderName: Schema.NullOr(Schema.String),
  lastSenderAddress: Schema.NullOr(EmailAddress),
  lastAuthor: Schema.NullOr(MessageAuthor),
  snippet: Schema.String,
  messageCount: NonNegativeInt,
  unread: Schema.Boolean,
  hasDraft: Schema.Boolean,
  needsReply: Schema.Boolean,
  state: Schema.NullOr(ConversationActorState),
})
export interface ConversationSummary extends Schema.Schema.Type<
  typeof ConversationSummary
> {}

export const ConversationPage = Schema.Struct({
  items: Schema.Array(ConversationSummary),
  nextCursor: Schema.NullOr(MailConversationCursor),
})
export interface ConversationPage extends Schema.Schema.Type<
  typeof ConversationPage
> {}

export const RepositoryRecipient = Schema.Struct({
  kind: RecipientKind,
  position: NonNegativeInt,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface RepositoryRecipient extends Schema.Schema.Type<
  typeof RepositoryRecipient
> {}

export const RepositoryAttachment = Schema.Struct({
  id: AttachmentId,
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  sizeBytes: NonNegativeInt,
  disposition: AttachmentDisposition,
  contentId: Schema.NullOr(NonEmptyString),
  position: NonNegativeInt,
})
export interface RepositoryAttachment extends Schema.Schema.Type<
  typeof RepositoryAttachment
> {}

/** Internal object-store reference returned only after conversation authorization. */
export const RawMessageContentRef = Schema.Struct({
  messageId: MessageId,
  storageKey: StorageKey,
  contentType: Schema.Literal('message/rfc822'),
})
export interface RawMessageContentRef extends Schema.Schema.Type<
  typeof RawMessageContentRef
> {}

/** Authorized attachment object-store reference plus immutable response metadata. */
export const AttachmentContentRef = Schema.Struct({
  messageId: MessageId,
  attachmentId: AttachmentId,
  storageKey: StorageKey,
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  sizeBytes: NonNegativeInt,
  contentHash: Sha256,
})
export interface AttachmentContentRef extends Schema.Schema.Type<
  typeof AttachmentContentRef
> {}

export const RepositoryMessage = Schema.Struct({
  id: MessageId,
  source: MessageSource,
  author: MessageAuthor,
  senderName: Schema.NullOr(Schema.String),
  senderAddress: EmailAddress,
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  internetMessageId: Schema.NullOr(NonEmptyString),
  inReplyToMessageId: Schema.NullOr(NonEmptyString),
  referenceMessageIds: Schema.Array(NonEmptyString),
  authoredAt: UtcTimestamp,
  replyTo: Schema.Array(EnvelopeReplyTo),
  recipients: Schema.Array(RepositoryRecipient),
  attachments: Schema.Array(RepositoryAttachment),
})
export interface RepositoryMessage extends Schema.Schema.Type<
  typeof RepositoryMessage
> {}

export const DraftSnapshot = Schema.Struct({
  id: DraftId,
  mailboxId: MailboxId,
  sender: DraftSender,
  conversationId: Schema.NullOr(ConversationId),
  author: MailActor,
  replyToMessageId: Schema.NullOr(MessageId),
  status: DraftStatus,
  revision: NonNegativeInt,
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  recipients: Schema.Array(EditableRecipient),
  attachments: Schema.Array(
    Schema.Struct({
      ...EditableAttachment.fields,
      fileName: NonEmptyString,
      contentType: NonEmptyString,
      sizeBytes: NonNegativeInt,
    }),
  ),
  updatedAt: UtcTimestamp,
})
export interface DraftSnapshot extends Schema.Schema.Type<
  typeof DraftSnapshot
> {}

export const AssignmentSnapshot = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  conversationId: ConversationId,
  assignee: MailActor,
  assignedBy: MailActionActor,
  assignedAt: UtcTimestamp,
  unassignedAt: Schema.NullOr(UtcTimestamp),
})
export interface AssignmentSnapshot extends Schema.Schema.Type<
  typeof AssignmentSnapshot
> {}

export const ConversationDetail = Schema.Struct({
  conversation: ConversationSummary,
  messages: Schema.Array(RepositoryMessage),
  drafts: Schema.Array(DraftSnapshot),
  assignments: Schema.Array(AssignmentSnapshot),
})
export interface ConversationDetail extends Schema.Schema.Type<
  typeof ConversationDetail
> {}

export const ResolvedLocalAddress = Schema.Struct({
  workspaceId: WorkspaceId,
  domainId: MailDomainId,
  localAddressId: MailAddressId,
  mailboxId: MailboxId,
  addressKind: MailAddressKind,
  matchedBy: Schema.Literals(['exact', 'catch_all']),
  envelopeAddress: EmailAddress,
})
export interface ResolvedLocalAddress extends Schema.Schema.Type<
  typeof ResolvedLocalAddress
> {}

/** Actor-authorized command that reserves one durable provider attempt. */
export const PrepareDraftDeliveryInput = Schema.Struct({
  workspaceId: WorkspaceId,
  draftId: DraftId,
  actor: MailActor,
  expectedRevision: NonNegativeInt,
})
export interface PrepareDraftDeliveryInput extends Schema.Schema.Type<
  typeof PrepareDraftDeliveryInput
> {}

export const PreparedDeliveryAddress = Schema.Struct({
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface PreparedDeliveryAddress extends Schema.Schema.Type<
  typeof PreparedDeliveryAddress
> {}

export const PreparedDeliveryAttachment = Schema.Struct({
  storageKey: StorageKey,
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  sizeBytes: NonNegativeInt,
  contentHash: Sha256,
  disposition: AttachmentDisposition,
  contentId: Schema.NullOr(NonEmptyString),
  position: NonNegativeInt,
})
export interface PreparedDeliveryAttachment extends Schema.Schema.Type<
  typeof PreparedDeliveryAttachment
> {}

/** Serializable payload passed from durable preparation to the network step. */
export const PreparedDelivery = Schema.Struct({
  workspaceId: WorkspaceId,
  draftId: DraftId,
  messageId: MessageId,
  conversationId: ConversationId,
  attemptId: DeliveryAttemptId,
  attemptNumber: PositiveInt,
  provider: ProviderKey,
  route: MailTransportRoute,
  from: PreparedDeliveryAddress,
  to: Schema.NonEmptyArray(PreparedDeliveryAddress),
  cc: Schema.Array(PreparedDeliveryAddress),
  bcc: Schema.Array(PreparedDeliveryAddress),
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  internetMessageId: NonEmptyString,
  inReplyToMessageId: Schema.NullOr(NonEmptyString),
  referenceMessageIds: Schema.Array(NonEmptyString),
  attachments: Schema.Array(PreparedDeliveryAttachment),
})
export interface PreparedDelivery extends Schema.Schema.Type<
  typeof PreparedDelivery
> {}

export const DeliveryPreparation = Schema.TaggedUnion({
  Ready: { delivery: PreparedDelivery },
  InFlight: {
    draftId: DraftId,
    messageId: MessageId,
    conversationId: ConversationId,
    attemptId: DeliveryAttemptId,
  },
  AlreadySent: {
    draftId: DraftId,
    messageId: MessageId,
    conversationId: ConversationId,
    providerMessageId: Schema.NullOr(ProviderObjectId),
  },
})
export type DeliveryPreparation = typeof DeliveryPreparation.Type

export const CompleteDraftDeliveryInput = Schema.Struct({
  workspaceId: WorkspaceId,
  draftId: DraftId,
  messageId: MessageId,
  attemptId: DeliveryAttemptId,
  provider: ProviderKey,
  providerMessageId: ProviderObjectId,
  occurredAt: UtcTimestamp,
})
export interface CompleteDraftDeliveryInput extends Schema.Schema.Type<
  typeof CompleteDraftDeliveryInput
> {}

export const FailDraftDeliveryInput = Schema.Struct({
  workspaceId: WorkspaceId,
  draftId: DraftId,
  messageId: MessageId,
  attemptId: DeliveryAttemptId,
  provider: ProviderKey,
  failureCode: Schema.NullOr(Schema.String),
  failureMessage: Schema.String,
  occurredAt: UtcTimestamp,
})
export interface FailDraftDeliveryInput extends Schema.Schema.Type<
  typeof FailDraftDeliveryInput
> {}

export class MailRepositoryAccessDeniedError extends Schema.TaggedErrorClass<MailRepositoryAccessDeniedError>()(
  'MailRepositoryAccessDeniedError',
  {
    workspaceId: WorkspaceId,
    resourceType: Schema.String,
    resourceId: Schema.String,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class MailRepositoryNotFoundError extends Schema.TaggedErrorClass<MailRepositoryNotFoundError>()(
  'MailRepositoryNotFoundError',
  {
    entity: Schema.String,
    id: Schema.String,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class MailDraftRevisionConflictError extends Schema.TaggedErrorClass<MailDraftRevisionConflictError>()(
  'MailDraftRevisionConflictError',
  {
    draftId: DraftId,
    expectedRevision: NonNegativeInt,
    actualRevision: NonNegativeInt,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class MailRepositoryInvariantError extends Schema.TaggedErrorClass<MailRepositoryInvariantError>()(
  'MailRepositoryInvariantError',
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class MailRepositoryPersistenceError extends Schema.TaggedErrorClass<MailRepositoryPersistenceError>()(
  'MailRepositoryPersistenceError',
  {
    reason: Schema.Literals(['connection', 'query', 'decode', 'transaction']),
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type MailRepositoryError =
  | MailRepositoryAccessDeniedError
  | MailRepositoryNotFoundError
  | MailDraftRevisionConflictError
  | MailRepositoryInvariantError
  | MailRepositoryPersistenceError

export interface MailRepositoryService {
  readonly listMailboxes: (
    input: ListMailboxesInput,
  ) => Effect.Effect<ReadonlyArray<AccessibleMailbox>, MailRepositoryError>
  readonly listConversations: (
    input: ListConversationsInput,
  ) => Effect.Effect<ReadonlyArray<ConversationSummary>, MailRepositoryError>
  readonly listConversationPage: (
    input: ListConversationPageInput,
  ) => Effect.Effect<ConversationPage, MailRepositoryError>
  readonly getConversation: (
    input: GetConversationInput,
  ) => Effect.Effect<ConversationDetail, MailRepositoryError>
  readonly getDraft: (
    input: GetDraftInput,
  ) => Effect.Effect<DraftSnapshot, MailRepositoryError>
  readonly getRawMessageContentRef: (
    input: GetRawMessageContentRefInput,
  ) => Effect.Effect<RawMessageContentRef, MailRepositoryError>
  readonly getAttachmentContentRef: (
    input: GetAttachmentContentRefInput,
  ) => Effect.Effect<AttachmentContentRef, MailRepositoryError>
  readonly resolveLocalAddress: (
    input: ResolveLocalAddressInput,
  ) => Effect.Effect<ResolvedLocalAddress, MailRepositoryError>
  readonly ingestInbound: (
    input: InboundMailEnvelope,
  ) => Effect.Effect<IngestedMail, MailRepositoryError>
  readonly ingestImported: (
    input: ImportedMailEnvelope,
  ) => Effect.Effect<IngestedMail, MailRepositoryError>
  readonly resolveMailSyncAccount: (
    input: ResolveMailSyncAccountInput,
  ) => Effect.Effect<MailSyncAccount, MailRepositoryError>
  readonly listPersonalMailSyncStates: (
    input: ListPersonalMailSyncStatesInput,
  ) => Effect.Effect<ReadonlyArray<PersonalMailSyncState>, MailRepositoryError>
  readonly startMailSyncRun: (
    input: StartMailSyncRunInput,
  ) => Effect.Effect<MailSyncRun, MailRepositoryError>
  readonly persistMailSyncPage: (
    input: PersistMailSyncPageInput,
  ) => Effect.Effect<number, MailRepositoryError>
  readonly finalizeMailSyncEnumeration: (
    input: FinalizeMailSyncEnumerationInput,
  ) => Effect.Effect<MailSyncRun, MailRepositoryError>
  readonly claimPendingMailSyncBatch: (
    input: ClaimPendingMailSyncBatchInput,
  ) => Effect.Effect<ReadonlyArray<MailSyncItem>, MailRepositoryError>
  readonly settleMailSyncItem: (
    input: SettleMailSyncItemInput,
  ) => Effect.Effect<MailSyncRun, MailRepositoryError>
  readonly completeMailSyncRun: (
    input: CompleteMailSyncRunInput,
  ) => Effect.Effect<MailSyncRun, MailRepositoryError>
  readonly failMailSyncRun: (
    input: FailMailSyncRunInput,
  ) => Effect.Effect<MailSyncRun, MailRepositoryError>
  readonly createDraft: (
    input: CreateDraftInput,
  ) => Effect.Effect<DraftSnapshot, MailRepositoryError>
  readonly saveDraft: (
    input: SaveDraftInput,
  ) => Effect.Effect<DraftSnapshot, MailRepositoryError>
  readonly transitionDraft: (
    input: TransitionDraftInput,
  ) => Effect.Effect<DraftSnapshot, MailRepositoryError>
  readonly prepareDraftDelivery: (
    input: PrepareDraftDeliveryInput,
  ) => Effect.Effect<DeliveryPreparation, MailRepositoryError>
  readonly completeDraftDelivery: (
    input: CompleteDraftDeliveryInput,
  ) => Effect.Effect<void, MailRepositoryError>
  readonly failDraftDelivery: (
    input: FailDraftDeliveryInput,
  ) => Effect.Effect<void, MailRepositoryError>
  readonly recordDeliveryOutcome: (
    input: RecordDeliveryOutcomeInput,
  ) => Effect.Effect<void, MailRepositoryError>
  readonly updateConversationState: (
    input: UpdateConversationStateInput,
  ) => Effect.Effect<ConversationActorState, MailRepositoryError>
  readonly assignConversation: (
    input: AssignConversationInput,
  ) => Effect.Effect<AssignmentSnapshot, MailRepositoryError>
  readonly unassignConversation: (
    input: UnassignConversationInput,
  ) => Effect.Effect<AssignmentSnapshot, MailRepositoryError>
}

/** Effect-owned persistence authority for Garden Mail. */
export class MailRepository extends Context.Service<
  MailRepository,
  MailRepositoryService
>()('@garden/server/MailRepository') {}
