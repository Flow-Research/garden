import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  mailAccessActorTypeValues,
  mailAccessLevelValues,
  mailActionActorTypeValues,
  mailAddress,
  mailAddressKindValues,
  mailAddressStatusValues,
  mailAttachment,
  mailAttachmentDispositionValues,
  mailConversation,
  mailConversationAssignment,
  mailConversationActorTypeValues,
  mailConversationMessage,
  mailConversationState,
  mailDeliveryAttempt,
  mailDeliveryStatusValues,
  mailDomain,
  mailDomainStatusValues,
  mailDraft,
  mailDraftActivity,
  mailDraftActivityActionValues,
  mailDraftAttachment,
  mailDraftRecipient,
  mailDraftStatusValues,
  mailMailbox,
  mailMailboxAccess,
  mailMailboxKindValues,
  mailMailboxStatusValues,
  mailMessage,
  mailMessageAttachment,
  mailMessageAuthorTypeValues,
  mailMessageLocalDelivery,
  mailMessageReplyTo,
  mailMessageSourceValues,
  mailRecipient,
  mailRecipientKindValues,
} from '../schema/mail.js'

export {
  mailAccessActorTypeValues,
  mailAccessLevelValues,
  mailActionActorTypeValues,
  mailAddressKindValues,
  mailAddressStatusValues,
  mailAttachmentDispositionValues,
  mailConversationActorTypeValues,
  mailDeliveryStatusValues,
  mailDomainStatusValues,
  mailDraftActivityActionValues,
  mailDraftStatusValues,
  mailMailboxKindValues,
  mailMailboxStatusValues,
  mailMessageAuthorTypeValues,
  mailMessageSourceValues,
  mailRecipientKindValues,
} from '../schema/mail.js'

const uuidSchema = z.string().uuid()
const domainNameSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
  )
const localPartSchema = z.string().regex(/^(?:\*|[a-z0-9][a-z0-9._%+-]*)$/)
const emailAddressSchema = z
  .string()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  .refine((value) => value === value.toLowerCase())
const providerEvidenceSchema = z.record(z.string(), z.json())
const nonEmptyStringSchema = z.string().trim().min(1)
const nonNegativeIntSchema = z.number().int().nonnegative()
const positiveIntSchema = z.number().int().positive()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const mailDomainStatusSchema = z.enum(mailDomainStatusValues)
export const mailMailboxKindSchema = z.enum(mailMailboxKindValues)
export const mailMailboxStatusSchema = z.enum(mailMailboxStatusValues)
export const mailAddressKindSchema = z.enum(mailAddressKindValues)
export const mailAddressStatusSchema = z.enum(mailAddressStatusValues)
export const mailAccessActorTypeSchema = z.enum(mailAccessActorTypeValues)
export const mailAccessLevelSchema = z.enum(mailAccessLevelValues)
export const mailActionActorTypeSchema = z.enum(mailActionActorTypeValues)
export const mailMessageSourceSchema = z.enum(mailMessageSourceValues)
export const mailMessageAuthorTypeSchema = z.enum(mailMessageAuthorTypeValues)
export const mailRecipientKindSchema = z.enum(mailRecipientKindValues)
export const mailDraftStatusSchema = z.enum(mailDraftStatusValues)
export const mailDraftActivityActionSchema = z.enum(
  mailDraftActivityActionValues,
)
export const mailAttachmentDispositionSchema = z.enum(
  mailAttachmentDispositionValues,
)
export const mailDeliveryStatusSchema = z.enum(mailDeliveryStatusValues)
export const mailConversationActorTypeSchema = z.enum(
  mailConversationActorTypeValues,
)

const mailDomainFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  name: () => domainNameSchema,
  status: () => mailDomainStatusSchema,
  transportProvider: () => nonEmptyStringSchema,
  providerEvidence: () => providerEvidenceSchema.nullable(),
}

export const mailDomainSelectSchema = createSelectSchema(
  mailDomain,
  mailDomainFields,
)
export const mailDomainInsertSchema = createInsertSchema(
  mailDomain,
  mailDomainFields,
)

const mailMailboxFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  name: () => nonEmptyStringSchema,
  kind: () => mailMailboxKindSchema,
  status: () => mailMailboxStatusSchema,
}

export const mailMailboxSelectSchema = createSelectSchema(
  mailMailbox,
  mailMailboxFields,
)
export const mailMailboxInsertSchema = createInsertSchema(
  mailMailbox,
  mailMailboxFields,
)

const mailAddressFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  domainId: () => uuidSchema,
  mailboxId: () => uuidSchema,
  localPart: () => localPartSchema,
  kind: () => mailAddressKindSchema,
  status: () => mailAddressStatusSchema,
}

export const mailAddressSelectSchema = createSelectSchema(
  mailAddress,
  mailAddressFields,
)
export const mailAddressInsertSchema = createInsertSchema(
  mailAddress,
  mailAddressFields,
)

const mailMailboxAccessFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  mailboxId: () => uuidSchema,
  actorType: () => mailAccessActorTypeSchema,
  memberId: () => uuidSchema.nullable(),
  agentId: () => uuidSchema.nullable(),
  accessLevel: () => mailAccessLevelSchema,
}

/** Mirrors the database's exclusive member/agent actor constraint. */
function hasMatchingActor(value: {
  actorType: 'member' | 'agent'
  memberId?: string | null
  agentId?: string | null
}) {
  return value.actorType === 'member'
    ? value.memberId != null && value.agentId == null
    : value.agentId != null && value.memberId == null
}

export const mailMailboxAccessSelectSchema = createSelectSchema(
  mailMailboxAccess,
  mailMailboxAccessFields,
).refine(hasMatchingActor, {
  message: 'actor type must match exactly one actor id',
})
export const mailMailboxAccessInsertSchema = createInsertSchema(
  mailMailboxAccess,
  mailMailboxAccessFields,
).refine(hasMatchingActor, {
  message: 'actor type must match exactly one actor id',
})

const mailConversationFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  mailboxId: () => uuidSchema,
  threadKey: () => nonEmptyStringSchema,
}

export const mailConversationSelectSchema = createSelectSchema(
  mailConversation,
  mailConversationFields,
)
export const mailConversationInsertSchema = createInsertSchema(
  mailConversation,
  mailConversationFields,
)

const mailMessageFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  source: () => mailMessageSourceSchema,
  authorType: () => mailMessageAuthorTypeSchema,
  authorMemberId: () => uuidSchema.nullable(),
  authorAgentId: () => uuidSchema.nullable(),
  senderAddressId: () => uuidSchema.nullable(),
  senderSyncAccountId: () => uuidSchema.nullable(),
  senderAddress: () => emailAddressSchema,
  referenceMessageIds: () => z.array(nonEmptyStringSchema),
  replyToMessageId: () => uuidSchema.nullable(),
  ingressProvider: () => nonEmptyStringSchema.nullable(),
  ingressProviderMessageId: () => nonEmptyStringSchema.nullable(),
  ingressProviderEvidence: () => providerEvidenceSchema.nullable(),
  rawStorageKey: () => nonEmptyStringSchema.nullable(),
}

/** Mirrors immutable message author and ingress identity constraints. */
function hasValidMessageIdentity(value: {
  source: (typeof mailMessageSourceValues)[number]
  authorType: (typeof mailMessageAuthorTypeValues)[number]
  authorMemberId?: string | null
  authorAgentId?: string | null
  ingressProvider?: string | null
  ingressProviderMessageId?: string | null
  senderAddressId?: string | null
  senderSyncAccountId?: string | null
}) {
  const authorValid =
    value.authorType === 'member'
      ? value.authorMemberId != null && value.authorAgentId == null
      : value.authorType === 'agent'
        ? value.authorAgentId != null && value.authorMemberId == null
        : value.authorMemberId == null && value.authorAgentId == null
  const providerPairValid =
    (value.ingressProvider == null) === (value.ingressProviderMessageId == null)
  const ingressValid =
    value.source === 'outbound' || value.ingressProvider != null
  const outboundSenderValid =
    value.source !== 'outbound' ||
    Number(value.senderAddressId != null) +
      Number(value.senderSyncAccountId != null) ===
      1
  return authorValid && providerPairValid && ingressValid && outboundSenderValid
}

export const mailMessageSelectSchema = createSelectSchema(
  mailMessage,
  mailMessageFields,
).refine(hasValidMessageIdentity, {
  message: 'invalid author or ingress identity',
})
export const mailMessageInsertSchema = createInsertSchema(
  mailMessage,
  mailMessageFields,
).refine(hasValidMessageIdentity, {
  message: 'invalid author or ingress identity',
})

const mailConversationMessageFields = {
  workspaceId: () => uuidSchema,
  conversationId: () => uuidSchema,
  messageId: () => uuidSchema,
}
export const mailConversationMessageSelectSchema = createSelectSchema(
  mailConversationMessage,
  mailConversationMessageFields,
)
export const mailConversationMessageInsertSchema = createInsertSchema(
  mailConversationMessage,
  mailConversationMessageFields,
)

const mailRecipientFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  messageId: () => uuidSchema,
  kind: () => mailRecipientKindSchema,
  position: () => nonNegativeIntSchema,
  address: () => emailAddressSchema,
}
export const mailRecipientSelectSchema = createSelectSchema(
  mailRecipient,
  mailRecipientFields,
)
export const mailRecipientInsertSchema = createInsertSchema(
  mailRecipient,
  mailRecipientFields,
)

const mailMessageReplyToFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  messageId: () => uuidSchema,
  position: () => nonNegativeIntSchema,
  address: () => emailAddressSchema,
}
export const mailMessageReplyToSelectSchema = createSelectSchema(
  mailMessageReplyTo,
  mailMessageReplyToFields,
)
export const mailMessageReplyToInsertSchema = createInsertSchema(
  mailMessageReplyTo,
  mailMessageReplyToFields,
)

const mailMessageLocalDeliveryFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  messageId: () => uuidSchema,
  localAddressId: () => uuidSchema,
  envelopeAddress: () => emailAddressSchema,
  providerRecipientId: () => nonEmptyStringSchema.nullable(),
  providerEvidence: () => providerEvidenceSchema.nullable(),
}
export const mailMessageLocalDeliverySelectSchema = createSelectSchema(
  mailMessageLocalDelivery,
  mailMessageLocalDeliveryFields,
)
export const mailMessageLocalDeliveryInsertSchema = createInsertSchema(
  mailMessageLocalDelivery,
  mailMessageLocalDeliveryFields,
)

const mailDraftFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  mailboxId: () => uuidSchema,
  fromAddressId: () => uuidSchema.nullable(),
  fromSyncAccountId: () => uuidSchema.nullable(),
  conversationId: () => uuidSchema.nullable(),
  authorType: () => mailAccessActorTypeSchema,
  authorMemberId: () => uuidSchema.nullable(),
  authorAgentId: () => uuidSchema.nullable(),
  replyToMessageId: () => uuidSchema.nullable(),
  sentMessageId: () => uuidSchema.nullable(),
  status: () => mailDraftStatusSchema,
  revision: () => nonNegativeIntSchema,
}

/** Draft actor and sent-message state are checked before persistence. */
function hasValidDraftIdentity(value: {
  authorType: 'member' | 'agent'
  authorMemberId?: string | null
  authorAgentId?: string | null
  status?: (typeof mailDraftStatusValues)[number]
  sentMessageId?: string | null
  fromAddressId?: string | null
  fromSyncAccountId?: string | null
}) {
  const actorValid = hasMatchingActor({
    actorType: value.authorType,
    memberId: value.authorMemberId,
    agentId: value.authorAgentId,
  })
  const sentStateValid =
    value.status === undefined ||
    (value.status === 'sent') === (value.sentMessageId != null)
  const senderValid =
    Number(value.fromAddressId != null) +
      Number(value.fromSyncAccountId != null) ===
    1
  return actorValid && sentStateValid && senderValid
}

export const mailDraftSelectSchema = createSelectSchema(
  mailDraft,
  mailDraftFields,
).refine(hasValidDraftIdentity, {
  message: 'invalid draft actor or sent state',
})
export const mailDraftInsertSchema = createInsertSchema(
  mailDraft,
  mailDraftFields,
).refine(hasValidDraftIdentity, {
  message: 'invalid draft actor or sent state',
})

const mailDraftRecipientFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  draftId: () => uuidSchema,
  kind: () => mailRecipientKindSchema,
  position: () => nonNegativeIntSchema,
  address: () => emailAddressSchema,
}
export const mailDraftRecipientSelectSchema = createSelectSchema(
  mailDraftRecipient,
  mailDraftRecipientFields,
)
export const mailDraftRecipientInsertSchema = createInsertSchema(
  mailDraftRecipient,
  mailDraftRecipientFields,
)

const mailAttachmentFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  storageKey: () => nonEmptyStringSchema,
  fileName: () => nonEmptyStringSchema,
  contentType: () => nonEmptyStringSchema,
  sizeBytes: () => nonNegativeIntSchema,
  contentHash: () => sha256Schema,
}
export const mailAttachmentSelectSchema = createSelectSchema(
  mailAttachment,
  mailAttachmentFields,
)
export const mailAttachmentInsertSchema = createInsertSchema(
  mailAttachment,
  mailAttachmentFields,
)

const mailAttachmentReferenceFields = {
  workspaceId: () => uuidSchema,
  attachmentId: () => uuidSchema,
  disposition: () => mailAttachmentDispositionSchema,
  contentId: () => nonEmptyStringSchema.nullable(),
  position: () => nonNegativeIntSchema,
}
export const mailMessageAttachmentSelectSchema = createSelectSchema(
  mailMessageAttachment,
  {
    ...mailAttachmentReferenceFields,
    messageId: () => uuidSchema,
  },
)
export const mailMessageAttachmentInsertSchema = createInsertSchema(
  mailMessageAttachment,
  {
    ...mailAttachmentReferenceFields,
    messageId: () => uuidSchema,
  },
)
export const mailDraftAttachmentSelectSchema = createSelectSchema(
  mailDraftAttachment,
  {
    ...mailAttachmentReferenceFields,
    draftId: () => uuidSchema,
  },
)
export const mailDraftAttachmentInsertSchema = createInsertSchema(
  mailDraftAttachment,
  {
    ...mailAttachmentReferenceFields,
    draftId: () => uuidSchema,
  },
)

const mailDeliveryAttemptFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  messageId: () => uuidSchema,
  attemptNumber: () => positiveIntSchema,
  provider: () => nonEmptyStringSchema,
  providerAttemptId: () => nonEmptyStringSchema.nullable(),
  status: () => mailDeliveryStatusSchema,
  providerEvidence: () => providerEvidenceSchema.nullable(),
}
export const mailDeliveryAttemptSelectSchema = createSelectSchema(
  mailDeliveryAttempt,
  mailDeliveryAttemptFields,
)
export const mailDeliveryAttemptInsertSchema = createInsertSchema(
  mailDeliveryAttempt,
  mailDeliveryAttemptFields,
)

const mailConversationStateFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  conversationId: () => uuidSchema,
  actorType: () => mailConversationActorTypeSchema,
  memberId: () => uuidSchema.nullable(),
  agentId: () => uuidSchema.nullable(),
  lastReadMessageId: () => uuidSchema.nullable(),
}
export const mailConversationStateSelectSchema = createSelectSchema(
  mailConversationState,
  mailConversationStateFields,
).refine(hasMatchingActor, {
  message: 'actor type must match exactly one actor id',
})
export const mailConversationStateInsertSchema = createInsertSchema(
  mailConversationState,
  mailConversationStateFields,
).refine(hasMatchingActor, {
  message: 'actor type must match exactly one actor id',
})

/** Validates a member, agent, or system action actor stored in flat columns. */
function hasMatchingActionActor(value: {
  actorType: 'member' | 'agent' | 'system'
  memberId?: string | null
  agentId?: string | null
}) {
  return value.actorType === 'member'
    ? value.memberId != null && value.agentId == null
    : value.actorType === 'agent'
      ? value.agentId != null && value.memberId == null
      : value.memberId == null && value.agentId == null
}

const mailDraftActivityFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  draftId: () => uuidSchema,
  sequence: () => positiveIntSchema,
  revision: () => nonNegativeIntSchema,
  actorType: () => mailActionActorTypeSchema,
  memberId: () => uuidSchema.nullable(),
  agentId: () => uuidSchema.nullable(),
  action: () => mailDraftActivityActionSchema,
  fromStatus: () => mailDraftStatusSchema.nullable(),
  toStatus: () => mailDraftStatusSchema,
  sentMessageId: () => uuidSchema.nullable(),
}

/** Mirrors actor, creation, and sent-message constraints for draft history. */
function hasValidDraftActivity(value: {
  actorType: 'member' | 'agent' | 'system'
  memberId?: string | null
  agentId?: string | null
  action: (typeof mailDraftActivityActionValues)[number]
  fromStatus?: (typeof mailDraftStatusValues)[number] | null
  sentMessageId?: string | null
}) {
  return (
    hasMatchingActionActor(value) &&
    (value.action === 'created') === (value.fromStatus == null) &&
    (value.action === 'sent') === (value.sentMessageId != null)
  )
}

export const mailDraftActivitySelectSchema = createSelectSchema(
  mailDraftActivity,
  mailDraftActivityFields,
).refine(hasValidDraftActivity, { message: 'invalid draft activity' })
export const mailDraftActivityInsertSchema = createInsertSchema(
  mailDraftActivity,
  mailDraftActivityFields,
).refine(hasValidDraftActivity, { message: 'invalid draft activity' })

const mailConversationAssignmentFields = {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  conversationId: () => uuidSchema,
  assigneeType: () => mailAccessActorTypeSchema,
  assigneeMemberId: () => uuidSchema.nullable(),
  assigneeAgentId: () => uuidSchema.nullable(),
  assignedByType: () => mailActionActorTypeSchema,
  assignedByMemberId: () => uuidSchema.nullable(),
  assignedByAgentId: () => uuidSchema.nullable(),
  unassignedByType: () => mailActionActorTypeSchema.nullable(),
  unassignedByMemberId: () => uuidSchema.nullable(),
  unassignedByAgentId: () => uuidSchema.nullable(),
}

/** Mirrors active/closed assignment actor attribution constraints. */
function hasValidAssignment(value: {
  assigneeType: 'member' | 'agent'
  assigneeMemberId?: string | null
  assigneeAgentId?: string | null
  assignedByType: 'member' | 'agent' | 'system'
  assignedByMemberId?: string | null
  assignedByAgentId?: string | null
  unassignedByType?: 'member' | 'agent' | 'system' | null
  unassignedByMemberId?: string | null
  unassignedByAgentId?: string | null
  unassignedAt?: Date | null
}) {
  const assigneeValid = hasMatchingActor({
    actorType: value.assigneeType,
    memberId: value.assigneeMemberId,
    agentId: value.assigneeAgentId,
  })
  const assignedByValid = hasMatchingActionActor({
    actorType: value.assignedByType,
    memberId: value.assignedByMemberId,
    agentId: value.assignedByAgentId,
  })
  const unassignedValid =
    value.unassignedAt == null
      ? value.unassignedByType == null &&
        value.unassignedByMemberId == null &&
        value.unassignedByAgentId == null
      : value.unassignedByType != null &&
        hasMatchingActionActor({
          actorType: value.unassignedByType,
          memberId: value.unassignedByMemberId,
          agentId: value.unassignedByAgentId,
        })
  return assigneeValid && assignedByValid && unassignedValid
}

export const mailConversationAssignmentSelectSchema = createSelectSchema(
  mailConversationAssignment,
  mailConversationAssignmentFields,
).refine(hasValidAssignment, { message: 'invalid conversation assignment' })
export const mailConversationAssignmentInsertSchema = createInsertSchema(
  mailConversationAssignment,
  mailConversationAssignmentFields,
).refine(hasValidAssignment, { message: 'invalid conversation assignment' })
