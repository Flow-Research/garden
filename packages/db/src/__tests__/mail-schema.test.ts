import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  mailConversationMessage,
  mailConversationState,
  mailDraft,
  mailDraftActivity,
  mailMessage,
  mailMessageLocalDelivery,
  mailRecipient,
} from '../schema/mail.js'
import {
  mailDraftActivityInsertSchema,
  mailMailboxAccessInsertSchema,
  mailMessageInsertSchema,
  mailMessageLocalDeliveryInsertSchema,
} from '../validation/mail.js'

const workspaceId = 'e0d06708-dc2d-4d8b-83d1-209ce463ea8c'
const memberId = '7178a1e8-c963-4842-9493-e80bb4c92d24'
const draftId = '715cab4c-dcb9-46bb-a53f-c50827a9e7ca'

describe('Garden Mail database boundaries', () => {
  it('rejects mailbox access whose actor discriminator and FK disagree', () => {
    const result = mailMailboxAccessInsertSchema.safeParse({
      workspaceId,
      mailboxId: 'c9c06be9-ed37-4a93-b2dd-3747b8a9cd08',
      actorType: 'member',
      memberId: null,
      agentId: '34b6080d-d183-4ca3-bc40-97da17b8cf95',
      accessLevel: 'editor',
    })

    expect(result.success).toBe(false)
  })

  it('requires idempotency identity on every inbound message', () => {
    const result = mailMessageInsertSchema.safeParse({
      workspaceId,
      source: 'inbound',
      authorType: 'external',
      authorMemberId: null,
      authorAgentId: null,
      senderAddress: 'customer@example.com',
      authoredAt: new Date('2026-08-10T10:00:00Z'),
    })

    expect(result.success).toBe(false)
  })

  it('accepts attributed human edits to an agent-authored draft ledger', () => {
    const result = mailDraftActivityInsertSchema.safeParse({
      workspaceId,
      draftId,
      sequence: 2,
      revision: 1,
      actorType: 'member',
      memberId,
      agentId: null,
      action: 'edited',
      fromStatus: 'editing',
      toStatus: 'editing',
      sentMessageId: null,
    })

    expect(result.success).toBe(true)
  })

  it('validates private local delivery independently from MIME recipients', () => {
    const result = mailMessageLocalDeliveryInsertSchema.safeParse({
      workspaceId,
      messageId: '31a93b7e-d5e6-40e2-9537-e23e37a8d6f5',
      localAddressId: 'be8f4ffb-1839-4dde-8398-73ce9606cde7',
      envelopeAddress: 'private@garden.test',
      providerRecipientId: 'recipient-private',
      providerEvidence: { route: 'catch-all' },
      receivedAt: new Date('2026-08-10T10:00:00Z'),
    })

    expect(result.success).toBe(true)
  })

  it('declares provider idempotency and cross-workspace projection constraints', () => {
    const messageConfig = getTableConfig(mailMessage)
    const projectionConfig = getTableConfig(mailConversationMessage)
    const activityConfig = getTableConfig(mailDraftActivity)
    const draftConfig = getTableConfig(mailDraft)
    const stateConfig = getTableConfig(mailConversationState)
    const localDeliveryConfig = getTableConfig(mailMessageLocalDelivery)
    const visibleRecipientConfig = getTableConfig(mailRecipient)

    expect(messageConfig.indexes.map((entry) => entry.config.name)).toContain(
      'mail_message_ingress_identity_unique',
    )
    expect(
      projectionConfig.foreignKeys.map((entry) => entry.getName()),
    ).toEqual(
      expect.arrayContaining([
        'mail_conversation_message_workspace_conversation_fk',
        'mail_conversation_message_workspace_message_fk',
      ]),
    )
    expect(activityConfig.indexes.map((entry) => entry.config.name)).toContain(
      'mail_draft_activity_draft_sequence_unique',
    )
    expect(draftConfig.foreignKeys.map((entry) => entry.getName())).toEqual(
      expect.arrayContaining([
        'mail_draft_conversation_reply_to_fk',
        'mail_draft_conversation_sent_message_fk',
      ]),
    )
    expect(stateConfig.foreignKeys.map((entry) => entry.getName())).toContain(
      'mail_conversation_state_last_read_projection_fk',
    )
    expect(
      localDeliveryConfig.indexes.map((entry) => entry.config.name),
    ).toContain('mail_message_local_delivery_message_address_unique')
    expect(
      localDeliveryConfig.foreignKeys.map((entry) => entry.getName()),
    ).toEqual(
      expect.arrayContaining([
        'mail_message_local_delivery_workspace_message_fk',
        'mail_message_local_delivery_workspace_address_fk',
      ]),
    )
    expect(
      visibleRecipientConfig.columns.map((column) => column.name),
    ).not.toContain('local_address_id')
  })
})
