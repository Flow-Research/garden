import { Schema } from 'effect'
import {
  MailActionActor,
  MailActor,
  DraftSender,
  MailSyncAccount,
  MailSyncItem,
  MailSyncRun,
  MessageAuthor,
} from './models.js'
import {
  AttachmentDisposition,
  AttachmentId,
  ConversationId,
  DomainName,
  DraftId,
  DraftActivityAction,
  DraftStatus,
  EmailAddress,
  InternetMessageId,
  LocalPart,
  MailAddressId,
  MailAddressKind,
  MailSyncProvider,
  MailSyncRunId,
  MailSyncRunTrigger,
  MailSyncAccountId,
  MailDomainId,
  MailboxAccessLevel,
  MailboxId,
  MailboxKind,
  MessageId,
  NonEmptyString,
  NonNegativeInt,
  ProviderEvidence,
  ProviderKey,
  ProviderObjectId,
  PositiveInt,
  RecipientKind,
  Sha256,
  StorageKey,
  UtcTimestamp,
  UserId,
  MemberId,
  WorkspaceId,
} from './values.js'

export const RegisterMailDomainInput = Schema.Struct({
  workspaceId: WorkspaceId,
  name: DomainName,
  transportProvider: ProviderKey,
})
export interface RegisterMailDomainInput extends Schema.Schema.Type<
  typeof RegisterMailDomainInput
> {}

export const RecordDomainVerificationInput = Schema.Struct({
  domainId: MailDomainId,
  providerDomainId: Schema.NullOr(ProviderObjectId),
  evidence: ProviderEvidence,
  verifiedAt: UtcTimestamp,
})
export interface RecordDomainVerificationInput extends Schema.Schema.Type<
  typeof RecordDomainVerificationInput
> {}

export const CreateMailboxInput = Schema.Struct({
  workspaceId: WorkspaceId,
  domainId: MailDomainId,
  name: NonEmptyString,
  kind: MailboxKind,
  primaryLocalPart: LocalPart,
  owner: MailActor,
})
export interface CreateMailboxInput extends Schema.Schema.Type<
  typeof CreateMailboxInput
> {}

export const CreateMailAddressInput = Schema.Struct({
  workspaceId: WorkspaceId,
  domainId: MailDomainId,
  mailboxId: MailboxId,
  localPart: LocalPart,
  kind: MailAddressKind,
})
export interface CreateMailAddressInput extends Schema.Schema.Type<
  typeof CreateMailAddressInput
> {}

export const SetMailboxAccessInput = Schema.Struct({
  workspaceId: WorkspaceId,
  mailboxId: MailboxId,
  actor: MailActor,
  accessLevel: MailboxAccessLevel,
})
export interface SetMailboxAccessInput extends Schema.Schema.Type<
  typeof SetMailboxAccessInput
> {}

export const EnvelopeRecipient = Schema.Struct({
  kind: RecipientKind,
  position: NonNegativeInt,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface EnvelopeRecipient extends Schema.Schema.Type<
  typeof EnvelopeRecipient
> {}

export const EnvelopeReplyTo = Schema.Struct({
  position: NonNegativeInt,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface EnvelopeReplyTo extends Schema.Schema.Type<
  typeof EnvelopeReplyTo
> {}

/**
 * Resolved SMTP-envelope destination. It stays private routing input and must
 * never be synthesized into a visible To/Cc/Bcc header recipient.
 */
export const LocalEnvelopeRecipient = Schema.Struct({
  localAddressId: MailAddressId,
  envelopeAddress: EmailAddress,
  providerRecipientId: Schema.NullOr(ProviderObjectId),
  providerEvidence: Schema.NullOr(ProviderEvidence),
})
export interface LocalEnvelopeRecipient extends Schema.Schema.Type<
  typeof LocalEnvelopeRecipient
> {}

export const InboundAttachment = Schema.Struct({
  storageKey: StorageKey,
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  sizeBytes: NonNegativeInt,
  contentHash: Sha256,
  disposition: AttachmentDisposition,
  contentId: Schema.NullOr(NonEmptyString),
  position: NonNegativeInt,
})
export interface InboundAttachment extends Schema.Schema.Type<
  typeof InboundAttachment
> {}

/**
 * Provider-neutral ingress contract. `provider + providerMessageId` is the
 * durable idempotency key; all matched local recipients arrive in one event.
 */
export const InboundMailEnvelope = Schema.Struct({
  workspaceId: WorkspaceId,
  provider: ProviderKey,
  providerMessageId: ProviderObjectId,
  providerEvidence: Schema.NullOr(ProviderEvidence),
  rawStorageKey: StorageKey,
  internetMessageId: Schema.NullOr(InternetMessageId),
  inReplyToMessageId: Schema.NullOr(InternetMessageId),
  referenceMessageIds: Schema.Array(InternetMessageId),
  author: MessageAuthor,
  senderName: Schema.NullOr(Schema.String),
  senderAddress: EmailAddress,
  replyTo: Schema.Array(EnvelopeReplyTo),
  /** Recipients parsed from actual MIME To/Cc/Bcc headers only. */
  recipients: Schema.Array(EnvelopeRecipient),
  localRecipients: Schema.Array(LocalEnvelopeRecipient).check(
    Schema.isMinLength(1),
  ),
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  attachments: Schema.Array(InboundAttachment),
  authoredAt: UtcTimestamp,
  receivedAt: UtcTimestamp,
})
export interface InboundMailEnvelope extends Schema.Schema.Type<
  typeof InboundMailEnvelope
> {}

/**
 * Provider-neutral external mailbox import. The repository binds the provider
 * object to its sync account and projects it into exactly that account's mailbox.
 */
export const ImportedMailEnvelope = Schema.Struct({
  workspaceId: WorkspaceId,
  syncAccountId: MailSyncAccountId,
  provider: ProviderKey,
  providerMessageId: ProviderObjectId,
  providerThreadId: ProviderObjectId,
  providerEvidence: Schema.NullOr(ProviderEvidence),
  rawStorageKey: Schema.NullOr(StorageKey),
  internetMessageId: Schema.NullOr(InternetMessageId),
  inReplyToMessageId: Schema.NullOr(InternetMessageId),
  referenceMessageIds: Schema.Array(InternetMessageId),
  author: MessageAuthor,
  senderName: Schema.NullOr(Schema.String),
  senderAddress: EmailAddress,
  replyTo: Schema.Array(EnvelopeReplyTo),
  recipients: Schema.Array(EnvelopeRecipient),
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  attachments: Schema.Array(InboundAttachment),
  authoredAt: UtcTimestamp,
})
export interface ImportedMailEnvelope extends Schema.Schema.Type<
  typeof ImportedMailEnvelope
> {}

export const IngestedMail = Schema.Struct({
  messageId: MessageId,
  conversationIds: Schema.Array(ConversationId),
  duplicate: Schema.Boolean,
})
export interface IngestedMail extends Schema.Schema.Type<typeof IngestedMail> {}

/** Creates or refreshes a connected personal account and its mailbox projection. */
export const ResolveMailSyncAccountInput = Schema.Struct({
  workspaceId: WorkspaceId,
  userId: UserId,
  memberId: MemberId,
  provider: MailSyncProvider,
  providerEmail: EmailAddress,
  mailboxName: NonEmptyString,
  executorIntegration: NonEmptyString,
  executorConnectionName: NonEmptyString,
})
export interface ResolveMailSyncAccountInput extends Schema.Schema.Type<
  typeof ResolveMailSyncAccountInput
> {}

export const ListPersonalMailSyncStatesInput = Schema.Struct({
  workspaceId: WorkspaceId,
  userId: UserId,
  provider: MailSyncProvider,
})
export interface ListPersonalMailSyncStatesInput extends Schema.Schema.Type<
  typeof ListPersonalMailSyncStatesInput
> {}

export const PersonalMailSyncState = Schema.Struct({
  account: Schema.NullOr(MailSyncAccount),
  latestRun: Schema.NullOr(MailSyncRun),
})
export interface PersonalMailSyncState extends Schema.Schema.Type<
  typeof PersonalMailSyncState
> {}

export const StartMailSyncRunInput = Schema.Struct({
  workspaceId: WorkspaceId,
  syncAccountId: MailSyncAccountId,
  workflowInstanceId: NonEmptyString,
  trigger: MailSyncRunTrigger,
})
export interface StartMailSyncRunInput extends Schema.Schema.Type<
  typeof StartMailSyncRunInput
> {}

export const EnumeratedMailSyncItem = Schema.Struct({
  providerMessageId: ProviderObjectId,
  providerThreadId: ProviderObjectId,
})
export interface EnumeratedMailSyncItem extends Schema.Schema.Type<
  typeof EnumeratedMailSyncItem
> {}

export const PersistMailSyncPageInput = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
  items: Schema.Array(EnumeratedMailSyncItem),
})
export interface PersistMailSyncPageInput extends Schema.Schema.Type<
  typeof PersistMailSyncPageInput
> {}

export const FinalizeMailSyncEnumerationInput = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
})
export interface FinalizeMailSyncEnumerationInput extends Schema.Schema.Type<
  typeof FinalizeMailSyncEnumerationInput
> {}

export const ClaimPendingMailSyncBatchInput = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
  claimKey: NonEmptyString,
  limit: PositiveInt,
})
export interface ClaimPendingMailSyncBatchInput extends Schema.Schema.Type<
  typeof ClaimPendingMailSyncBatchInput
> {}

export const MailSyncItemSettlement = Schema.TaggedUnion({
  Imported: { messageId: MessageId },
  Duplicate: { messageId: MessageId },
  Failed: { error: NonEmptyString },
})
export type MailSyncItemSettlement = typeof MailSyncItemSettlement.Type

export const SettleMailSyncItemInput = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
  providerMessageId: ProviderObjectId,
  claimKey: NonEmptyString,
  settlement: MailSyncItemSettlement,
})
export interface SettleMailSyncItemInput extends Schema.Schema.Type<
  typeof SettleMailSyncItemInput
> {}

export const CompleteMailSyncRunInput = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
  historyId: Schema.NullOr(ProviderObjectId),
})
export interface CompleteMailSyncRunInput extends Schema.Schema.Type<
  typeof CompleteMailSyncRunInput
> {}

export const FailMailSyncRunInput = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
  error: NonEmptyString,
})
export interface FailMailSyncRunInput extends Schema.Schema.Type<
  typeof FailMailSyncRunInput
> {}

export const CancelMailSyncRunInput = Schema.Struct({
  workspaceId: WorkspaceId,
  runId: MailSyncRunId,
})
export interface CancelMailSyncRunInput extends Schema.Schema.Type<
  typeof CancelMailSyncRunInput
> {}

export const ClaimedMailSyncBatch = Schema.Array(MailSyncItem)
export type ClaimedMailSyncBatch = typeof ClaimedMailSyncBatch.Type

export const EditableRecipient = Schema.Struct({
  kind: RecipientKind,
  position: NonNegativeInt,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
})
export interface EditableRecipient extends Schema.Schema.Type<
  typeof EditableRecipient
> {}

export const EditableAttachment = Schema.Struct({
  attachmentId: AttachmentId,
  disposition: AttachmentDisposition,
  contentId: Schema.NullOr(NonEmptyString),
  position: NonNegativeInt,
})
export interface EditableAttachment extends Schema.Schema.Type<
  typeof EditableAttachment
> {}

/** Expected revision makes concurrent human/agent edits explicit. */
export const SaveDraftInput = Schema.Struct({
  draftId: DraftId,
  workspaceId: WorkspaceId,
  actor: MailActor,
  expectedRevision: NonNegativeInt,
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  recipients: Schema.Array(EditableRecipient),
  attachments: Schema.Array(EditableAttachment),
})
export interface SaveDraftInput extends Schema.Schema.Type<
  typeof SaveDraftInput
> {}

export const CreateDraftInput = Schema.Struct({
  workspaceId: WorkspaceId,
  mailboxId: MailboxId,
  sender: DraftSender,
  conversationId: Schema.NullOr(ConversationId),
  author: MailActor,
  replyToMessageId: Schema.NullOr(MessageId),
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  recipients: Schema.Array(EditableRecipient),
  attachments: Schema.Array(EditableAttachment),
})
export interface CreateDraftInput extends Schema.Schema.Type<
  typeof CreateDraftInput
> {}

/** Delivery authorization is checked against the same revision that is sent. */
export const RequestDraftDeliveryInput = Schema.Struct({
  workspaceId: WorkspaceId,
  draftId: DraftId,
  actor: MailActor,
  expectedRevision: NonNegativeInt,
})
export interface RequestDraftDeliveryInput extends Schema.Schema.Type<
  typeof RequestDraftDeliveryInput
> {}

/** One typed command covers approval and send workflow transitions. */
export const TransitionDraftInput = Schema.Struct({
  workspaceId: WorkspaceId,
  draftId: DraftId,
  actor: MailActionActor,
  expectedRevision: NonNegativeInt,
  action: DraftActivityAction,
  toStatus: DraftStatus,
})
export interface TransitionDraftInput extends Schema.Schema.Type<
  typeof TransitionDraftInput
> {}

/** Repository contract for appending the immutable draft activity ledger. */
export const AppendDraftActivityInput = Schema.Struct({
  workspaceId: WorkspaceId,
  draftId: DraftId,
  sequence: PositiveInt,
  revision: NonNegativeInt,
  actor: MailActionActor,
  action: DraftActivityAction,
  fromStatus: Schema.NullOr(DraftStatus),
  toStatus: DraftStatus,
  sentMessageId: Schema.NullOr(MessageId),
  occurredAt: UtcTimestamp,
})
export interface AppendDraftActivityInput extends Schema.Schema.Type<
  typeof AppendDraftActivityInput
> {}

export const RecordDeliveryOutcomeInput = Schema.Struct({
  workspaceId: WorkspaceId,
  messageId: MessageId,
  provider: ProviderKey,
  providerAttemptId: ProviderObjectId,
  status: Schema.Literals([
    'submitted',
    'delivered',
    'deferred',
    'bounced',
    'failed',
  ]),
  failureCode: Schema.NullOr(Schema.String),
  failureMessage: Schema.NullOr(Schema.String),
  evidence: Schema.NullOr(ProviderEvidence),
  occurredAt: UtcTimestamp,
})
export interface RecordDeliveryOutcomeInput extends Schema.Schema.Type<
  typeof RecordDeliveryOutcomeInput
> {}

export const UpdateConversationStateInput = Schema.Struct({
  workspaceId: WorkspaceId,
  conversationId: ConversationId,
  actor: MailActor,
  lastReadMessageId: Schema.NullOr(MessageId),
  readAt: Schema.NullOr(UtcTimestamp),
  archivedAt: Schema.NullOr(UtcTimestamp),
  mutedAt: Schema.NullOr(UtcTimestamp),
  pinned: Schema.Boolean,
})
export interface UpdateConversationStateInput extends Schema.Schema.Type<
  typeof UpdateConversationStateInput
> {}

export const AssignConversationInput = Schema.Struct({
  workspaceId: WorkspaceId,
  conversationId: ConversationId,
  assignee: MailActor,
  assignedBy: MailActionActor,
})
export interface AssignConversationInput extends Schema.Schema.Type<
  typeof AssignConversationInput
> {}

export const UnassignConversationInput = Schema.Struct({
  workspaceId: WorkspaceId,
  conversationId: ConversationId,
  assignee: MailActor,
  unassignedBy: MailActionActor,
})
export interface UnassignConversationInput extends Schema.Schema.Type<
  typeof UnassignConversationInput
> {}
