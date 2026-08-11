import { Schema } from 'effect'

const Uuid = Schema.String.check(Schema.isUUID())

/** Branded identifiers keep repository and workflow arguments tenant-safe. */
export const WorkspaceId = Uuid.pipe(Schema.brand('WorkspaceId'))
export type WorkspaceId = typeof WorkspaceId.Type
export const MemberId = Uuid.pipe(Schema.brand('MemberId'))
export type MemberId = typeof MemberId.Type
export const UserId = Uuid.pipe(Schema.brand('UserId'))
export type UserId = typeof UserId.Type
export const AgentId = Uuid.pipe(Schema.brand('AgentId'))
export type AgentId = typeof AgentId.Type
export const MailDomainId = Uuid.pipe(Schema.brand('MailDomainId'))
export type MailDomainId = typeof MailDomainId.Type
export const MailboxId = Uuid.pipe(Schema.brand('MailboxId'))
export type MailboxId = typeof MailboxId.Type
export const MailAddressId = Uuid.pipe(Schema.brand('MailAddressId'))
export type MailAddressId = typeof MailAddressId.Type
export const MailboxAccessId = Uuid.pipe(Schema.brand('MailboxAccessId'))
export type MailboxAccessId = typeof MailboxAccessId.Type
export const MailSyncAccountId = Uuid.pipe(Schema.brand('MailSyncAccountId'))
export type MailSyncAccountId = typeof MailSyncAccountId.Type
export const MailSyncRunId = Uuid.pipe(Schema.brand('MailSyncRunId'))
export type MailSyncRunId = typeof MailSyncRunId.Type
export const ConversationId = Uuid.pipe(Schema.brand('ConversationId'))
export type ConversationId = typeof ConversationId.Type
export const MessageId = Uuid.pipe(Schema.brand('MessageId'))
export type MessageId = typeof MessageId.Type
export const RecipientId = Uuid.pipe(Schema.brand('RecipientId'))
export type RecipientId = typeof RecipientId.Type
export const LocalDeliveryId = Uuid.pipe(Schema.brand('LocalDeliveryId'))
export type LocalDeliveryId = typeof LocalDeliveryId.Type
export const DraftId = Uuid.pipe(Schema.brand('DraftId'))
export type DraftId = typeof DraftId.Type
export const AttachmentId = Uuid.pipe(Schema.brand('AttachmentId'))
export type AttachmentId = typeof AttachmentId.Type
export const DeliveryAttemptId = Uuid.pipe(Schema.brand('DeliveryAttemptId'))
export type DeliveryAttemptId = typeof DeliveryAttemptId.Type
export const ConversationStateId = Uuid.pipe(
  Schema.brand('ConversationStateId'),
)
export type ConversationStateId = typeof ConversationStateId.Type
export const DraftActivityId = Uuid.pipe(Schema.brand('DraftActivityId'))
export type DraftActivityId = typeof DraftActivityId.Type
export const ConversationAssignmentId = Uuid.pipe(
  Schema.brand('ConversationAssignmentId'),
)
export type ConversationAssignmentId = typeof ConversationAssignmentId.Type

export const NonEmptyString = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
)
export const ProviderKey = NonEmptyString.pipe(Schema.brand('ProviderKey'))
export type ProviderKey = typeof ProviderKey.Type
export const ProviderObjectId = NonEmptyString.pipe(
  Schema.brand('ProviderObjectId'),
)
export type ProviderObjectId = typeof ProviderObjectId.Type
export const StorageKey = NonEmptyString.pipe(Schema.brand('StorageKey'))
export type StorageKey = typeof StorageKey.Type
export const ThreadKey = NonEmptyString.pipe(Schema.brand('ThreadKey'))
export type ThreadKey = typeof ThreadKey.Type
export const InternetMessageId = NonEmptyString.pipe(
  Schema.brand('InternetMessageId'),
)
export type InternetMessageId = typeof InternetMessageId.Type

export const DomainName = Schema.Trim.pipe(
  Schema.check(
    Schema.isPattern(
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
    ),
  ),
  Schema.brand('DomainName'),
)
export type DomainName = typeof DomainName.Type

export const LocalPart = Schema.Trim.pipe(
  Schema.check(Schema.isPattern(/^(?:\*|[a-z0-9][a-z0-9._%+-]*)$/)),
  Schema.brand('LocalPart'),
)
export type LocalPart = typeof LocalPart.Type

export const EmailAddress = Schema.Trim.pipe(
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  Schema.brand('EmailAddress'),
)
export type EmailAddress = typeof EmailAddress.Type

export const Sha256 = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{64}$/),
).pipe(Schema.brand('Sha256'))
export type Sha256 = typeof Sha256.Type

/** Plain UTC wire timestamps remain serializable through TanStack boundaries. */
export const UtcTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/),
).pipe(Schema.brand('UtcTimestamp'))
export type UtcTimestamp = typeof UtcTimestamp.Type

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const ProviderEvidence = Schema.Record(Schema.String, Schema.Json)
export type ProviderEvidence = typeof ProviderEvidence.Type

export const MailDomainStatus = Schema.Literals([
  'pending_verification',
  'active',
  'suspended',
  'failed',
])
export type MailDomainStatus = typeof MailDomainStatus.Type
export const MailboxKind = Schema.Literals(['personal', 'shared', 'agent'])
export type MailboxKind = typeof MailboxKind.Type
export const MailboxStatus = Schema.Literals(['active', 'disabled'])
export type MailboxStatus = typeof MailboxStatus.Type
export const MailboxOrigin = Schema.Literals([
  'garden_hosted',
  'external_import',
])
export type MailboxOrigin = typeof MailboxOrigin.Type
export const MailboxSendCapability = Schema.Literals([
  'garden_transport',
  'gmail_transport',
  'read_only',
])
export type MailboxSendCapability = typeof MailboxSendCapability.Type
export const MailSyncProvider = Schema.Literal('gmail')
export type MailSyncProvider = typeof MailSyncProvider.Type
export const MailSyncAccountStatus = Schema.Literals([
  'connected',
  'syncing',
  'ready',
  'degraded',
  'disconnected',
])
export type MailSyncAccountStatus = typeof MailSyncAccountStatus.Type
export const MailSyncRunTrigger = Schema.Literals([
  'initial',
  'manual',
  'incremental',
  'recovery',
])
export type MailSyncRunTrigger = typeof MailSyncRunTrigger.Type
export const MailSyncRunStatus = Schema.Literals([
  'queued',
  'enumerating',
  'importing',
  'completed',
  'failed',
  'cancelled',
])
export type MailSyncRunStatus = typeof MailSyncRunStatus.Type
export const MailSyncItemStatus = Schema.Literals([
  'pending',
  'processing',
  'imported',
  'duplicate',
  'failed',
])
export type MailSyncItemStatus = typeof MailSyncItemStatus.Type
export const MailAddressKind = Schema.Literals([
  'primary',
  'alias',
  'catch_all',
])
export type MailAddressKind = typeof MailAddressKind.Type
export const MailAddressStatus = Schema.Literals(['active', 'disabled'])
export type MailAddressStatus = typeof MailAddressStatus.Type
export const MailboxAccessLevel = Schema.Literals(['owner', 'editor', 'viewer'])
export type MailboxAccessLevel = typeof MailboxAccessLevel.Type
export const MessageSource = Schema.Literals([
  'inbound',
  'outbound',
  'imported',
])
export type MessageSource = typeof MessageSource.Type
export const RecipientKind = Schema.Literals(['to', 'cc', 'bcc'])
export type RecipientKind = typeof RecipientKind.Type
export const DraftStatus = Schema.Literals([
  'editing',
  'awaiting_approval',
  'approved',
  'sending',
  'send_failed',
  'sent',
  'discarded',
])
export type DraftStatus = typeof DraftStatus.Type
export const DraftActivityAction = Schema.Literals([
  'created',
  'edited',
  'submitted_for_approval',
  'approved',
  'changes_requested',
  'send_requested',
  'retry_requested',
  'send_failed',
  'sent',
  'discarded',
])
export type DraftActivityAction = typeof DraftActivityAction.Type
export const AttachmentDisposition = Schema.Literals(['attachment', 'inline'])
export type AttachmentDisposition = typeof AttachmentDisposition.Type
export const DeliveryStatus = Schema.Literals([
  'queued',
  'submitted',
  'delivered',
  'deferred',
  'bounced',
  'failed',
  'canceled',
])
export type DeliveryStatus = typeof DeliveryStatus.Type
