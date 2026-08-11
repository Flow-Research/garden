import { Schema } from 'effect'
import {
  AgentId,
  AttachmentDisposition,
  AttachmentId,
  ConversationId,
  ConversationAssignmentId,
  ConversationStateId,
  DeliveryAttemptId,
  DeliveryStatus,
  DomainName,
  DraftId,
  DraftActivityAction,
  DraftActivityId,
  DraftStatus,
  EmailAddress,
  InternetMessageId,
  LocalPart,
  LocalDeliveryId,
  MailAddressId,
  MailAddressKind,
  MailAddressStatus,
  MailDomainId,
  MailDomainStatus,
  MailboxAccessId,
  MailboxAccessLevel,
  MailboxId,
  MailboxKind,
  MailboxOrigin,
  MailboxStatus,
  MailSyncAccountId,
  MailSyncAccountStatus,
  MailSyncItemStatus,
  MailSyncProvider,
  MailSyncRunId,
  MailSyncRunStatus,
  MailSyncRunTrigger,
  MemberId,
  MessageId,
  MessageSource,
  NonEmptyString,
  NonNegativeInt,
  PositiveInt,
  ProviderEvidence,
  ProviderKey,
  ProviderObjectId,
  RecipientId,
  RecipientKind,
  Sha256,
  StorageKey,
  ThreadKey,
  UtcTimestamp,
  UserId,
  WorkspaceId,
} from './values.js'

/** Member and agent actors share mail authorization without losing identity. */
export const MailActor = Schema.TaggedUnion({
  Member: { memberId: MemberId },
  Agent: { agentId: AgentId },
})
export type MailActor = typeof MailActor.Type

/** System joins members and agents only for auditable automated actions. */
export const MailActionActor = Schema.TaggedUnion({
  Member: { memberId: MemberId },
  Agent: { agentId: AgentId },
  System: {},
})
export type MailActionActor = typeof MailActionActor.Type

/** Authorship additionally represents people outside Garden and system mail. */
export const MessageAuthor = Schema.TaggedUnion({
  External: {},
  Member: { memberId: MemberId },
  Agent: { agentId: AgentId },
  System: {},
})
export type MessageAuthor = typeof MessageAuthor.Type

export const MailDomain = Schema.Struct({
  id: MailDomainId,
  workspaceId: WorkspaceId,
  name: DomainName,
  status: MailDomainStatus,
  transportProvider: ProviderKey,
  providerDomainId: Schema.NullOr(ProviderObjectId),
  providerEvidence: Schema.NullOr(ProviderEvidence),
  verifiedAt: Schema.NullOr(UtcTimestamp),
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface MailDomain extends Schema.Schema.Type<typeof MailDomain> {}

export const Mailbox = Schema.Struct({
  id: MailboxId,
  workspaceId: WorkspaceId,
  name: NonEmptyString,
  kind: MailboxKind,
  origin: MailboxOrigin,
  status: MailboxStatus,
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface Mailbox extends Schema.Schema.Type<typeof Mailbox> {}

/** A provider connection owns one external, read-only mailbox projection. */
export const MailSyncAccount = Schema.Struct({
  id: MailSyncAccountId,
  workspaceId: WorkspaceId,
  mailboxId: MailboxId,
  userId: UserId,
  provider: MailSyncProvider,
  providerEmail: EmailAddress,
  executorIntegration: NonEmptyString,
  executorConnectionName: NonEmptyString,
  status: MailSyncAccountStatus,
  historyId: Schema.NullOr(ProviderObjectId),
  watchExpiration: Schema.NullOr(UtcTimestamp),
  lastSyncedAt: Schema.NullOr(UtcTimestamp),
  lastError: Schema.NullOr(Schema.String),
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface MailSyncAccount extends Schema.Schema.Type<
  typeof MailSyncAccount
> {}

/** Durable progress snapshot shared by API polling and Workflow execution. */
export const MailSyncRun = Schema.Struct({
  id: MailSyncRunId,
  workspaceId: WorkspaceId,
  syncAccountId: MailSyncAccountId,
  workflowInstanceId: NonEmptyString,
  trigger: MailSyncRunTrigger,
  status: MailSyncRunStatus,
  totalMessages: Schema.NullOr(NonNegativeInt),
  processedMessages: NonNegativeInt,
  importedMessages: NonNegativeInt,
  duplicateMessages: NonNegativeInt,
  failedMessages: NonNegativeInt,
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(UtcTimestamp),
  completedAt: Schema.NullOr(UtcTimestamp),
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface MailSyncRun extends Schema.Schema.Type<typeof MailSyncRun> {}

/** One enumerated provider object; run + provider id is its durable identity. */
export const MailSyncItem = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
  providerMessageId: ProviderObjectId,
  providerThreadId: ProviderObjectId,
  ordinal: NonNegativeInt,
  status: MailSyncItemStatus,
  claimKey: Schema.NullOr(NonEmptyString),
  messageId: Schema.NullOr(MessageId),
  error: Schema.NullOr(Schema.String),
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface MailSyncItem extends Schema.Schema.Type<typeof MailSyncItem> {}

export const MailAddress = Schema.Struct({
  id: MailAddressId,
  workspaceId: WorkspaceId,
  domainId: MailDomainId,
  mailboxId: MailboxId,
  localPart: LocalPart,
  kind: MailAddressKind,
  status: MailAddressStatus,
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface MailAddress extends Schema.Schema.Type<typeof MailAddress> {}

export const MailboxAccess = Schema.Struct({
  id: MailboxAccessId,
  workspaceId: WorkspaceId,
  mailboxId: MailboxId,
  actor: MailActor,
  accessLevel: MailboxAccessLevel,
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface MailboxAccess extends Schema.Schema.Type<
  typeof MailboxAccess
> {}

export const Conversation = Schema.Struct({
  id: ConversationId,
  workspaceId: WorkspaceId,
  mailboxId: MailboxId,
  threadKey: ThreadKey,
  subject: Schema.String,
  normalizedSubject: Schema.String,
  lastMessageAt: Schema.NullOr(UtcTimestamp),
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface Conversation extends Schema.Schema.Type<typeof Conversation> {}

export const Message = Schema.Struct({
  id: MessageId,
  workspaceId: WorkspaceId,
  source: MessageSource,
  author: MessageAuthor,
  senderName: Schema.NullOr(Schema.String),
  senderAddressId: Schema.NullOr(MailAddressId),
  senderAddress: EmailAddress,
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  internetMessageId: Schema.NullOr(InternetMessageId),
  inReplyToMessageId: Schema.NullOr(InternetMessageId),
  referenceMessageIds: Schema.Array(InternetMessageId),
  replyToMessageId: Schema.NullOr(MessageId),
  ingressProvider: Schema.NullOr(ProviderKey),
  ingressProviderMessageId: Schema.NullOr(ProviderObjectId),
  ingressProviderEvidence: Schema.NullOr(ProviderEvidence),
  rawStorageKey: Schema.NullOr(StorageKey),
  authoredAt: UtcTimestamp,
  createdAt: UtcTimestamp,
})
export interface Message extends Schema.Schema.Type<typeof Message> {}

export const Recipient = Schema.Struct({
  id: RecipientId,
  messageId: MessageId,
  kind: RecipientKind,
  position: NonNegativeInt,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface Recipient extends Schema.Schema.Type<typeof Recipient> {}

/** RFC Reply-To mailboxes are ordered visible message metadata. */
export const MessageReplyTo = Schema.Struct({
  id: RecipientId,
  messageId: MessageId,
  position: NonNegativeInt,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface MessageReplyTo extends Schema.Schema.Type<
  typeof MessageReplyTo
> {}

/**
 * Private local routing metadata. Repositories must authorize it by mailbox;
 * it is deliberately absent from the message-visible recipient collection.
 */
export const LocalDelivery = Schema.Struct({
  id: LocalDeliveryId,
  workspaceId: WorkspaceId,
  messageId: MessageId,
  localAddressId: MailAddressId,
  envelopeAddress: EmailAddress,
  providerRecipientId: Schema.NullOr(ProviderObjectId),
  providerEvidence: Schema.NullOr(ProviderEvidence),
  receivedAt: UtcTimestamp,
  createdAt: UtcTimestamp,
})
export interface LocalDelivery extends Schema.Schema.Type<
  typeof LocalDelivery
> {}

export const Draft = Schema.Struct({
  id: DraftId,
  workspaceId: WorkspaceId,
  mailboxId: MailboxId,
  fromAddressId: MailAddressId,
  conversationId: Schema.NullOr(ConversationId),
  author: MailActor,
  replyToMessageId: Schema.NullOr(MessageId),
  sentMessageId: Schema.NullOr(MessageId),
  status: DraftStatus,
  revision: NonNegativeInt,
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface Draft extends Schema.Schema.Type<typeof Draft> {}

export const DraftRecipient = Schema.Struct({
  id: RecipientId,
  draftId: DraftId,
  kind: RecipientKind,
  position: NonNegativeInt,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface DraftRecipient extends Schema.Schema.Type<
  typeof DraftRecipient
> {}

export const Attachment = Schema.Struct({
  id: AttachmentId,
  workspaceId: WorkspaceId,
  storageKey: StorageKey,
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  sizeBytes: NonNegativeInt,
  contentHash: Sha256,
  createdAt: UtcTimestamp,
})
export interface Attachment extends Schema.Schema.Type<typeof Attachment> {}

export const AttachmentReference = Schema.Struct({
  attachmentId: AttachmentId,
  disposition: AttachmentDisposition,
  contentId: Schema.NullOr(NonEmptyString),
  position: NonNegativeInt,
})
export interface AttachmentReference extends Schema.Schema.Type<
  typeof AttachmentReference
> {}

export const DeliveryAttempt = Schema.Struct({
  id: DeliveryAttemptId,
  workspaceId: WorkspaceId,
  messageId: MessageId,
  attemptNumber: PositiveInt,
  provider: ProviderKey,
  providerAttemptId: Schema.NullOr(ProviderObjectId),
  status: DeliveryStatus,
  failureCode: Schema.NullOr(Schema.String),
  failureMessage: Schema.NullOr(Schema.String),
  providerEvidence: Schema.NullOr(ProviderEvidence),
  nextAttemptAt: Schema.NullOr(UtcTimestamp),
  submittedAt: Schema.NullOr(UtcTimestamp),
  completedAt: Schema.NullOr(UtcTimestamp),
  createdAt: UtcTimestamp,
  updatedAt: UtcTimestamp,
})
export interface DeliveryAttempt extends Schema.Schema.Type<
  typeof DeliveryAttempt
> {}

export const ConversationState = Schema.Struct({
  id: ConversationStateId,
  workspaceId: WorkspaceId,
  conversationId: ConversationId,
  actor: MailActor,
  lastReadMessageId: Schema.NullOr(MessageId),
  readAt: Schema.NullOr(UtcTimestamp),
  archivedAt: Schema.NullOr(UtcTimestamp),
  mutedAt: Schema.NullOr(UtcTimestamp),
  pinned: Schema.Boolean,
  updatedAt: UtcTimestamp,
})
export interface ConversationState extends Schema.Schema.Type<
  typeof ConversationState
> {}

/** Immutable event identifying every draft edit, approval, and send action. */
export const DraftActivity = Schema.Struct({
  id: DraftActivityId,
  workspaceId: WorkspaceId,
  draftId: DraftId,
  sequence: PositiveInt,
  revision: NonNegativeInt,
  actor: MailActionActor,
  action: DraftActivityAction,
  fromStatus: Schema.NullOr(DraftStatus),
  toStatus: DraftStatus,
  sentMessageId: Schema.NullOr(MessageId),
  createdAt: UtcTimestamp,
})
export interface DraftActivity extends Schema.Schema.Type<
  typeof DraftActivity
> {}

export const AssignmentLifecycle = Schema.TaggedUnion({
  Active: {},
  Unassigned: {
    unassignedBy: MailActionActor,
    unassignedAt: UtcTimestamp,
  },
})
export type AssignmentLifecycle = typeof AssignmentLifecycle.Type

export const ConversationAssignment = Schema.Struct({
  id: ConversationAssignmentId,
  workspaceId: WorkspaceId,
  conversationId: ConversationId,
  assignee: MailActor,
  assignedBy: MailActionActor,
  assignedAt: UtcTimestamp,
  lifecycle: AssignmentLifecycle,
})
export interface ConversationAssignment extends Schema.Schema.Type<
  typeof ConversationAssignment
> {}
