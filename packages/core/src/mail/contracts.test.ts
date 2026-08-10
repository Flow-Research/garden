import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  AssignConversationInput,
  InboundMailEnvelope,
  SaveDraftInput,
} from './operations.js'

const workspaceId = 'e0d06708-dc2d-4d8b-83d1-209ce463ea8c'
const memberId = '7178a1e8-c963-4842-9493-e80bb4c92d24'
const agentId = '34b6080d-d183-4ca3-bc40-97da17b8cf95'
const conversationId = '7c28c161-e9d6-456d-a4e1-8c0817288274'
const draftId = '715cab4c-dcb9-46bb-a53f-c50827a9e7ca'

describe('Garden Mail Effect contracts', () => {
  it('accepts one provider event addressed to multiple local mailboxes', () => {
    const envelope = Schema.decodeUnknownSync(InboundMailEnvelope)({
      workspaceId,
      provider: 'cloudflare',
      providerMessageId: 'event-123',
      providerEvidence: { authenticated: true },
      rawStorageKey: 'raw/event-123.eml',
      internetMessageId: '<message@example.com>',
      inReplyToMessageId: null,
      referenceMessageIds: [],
      author: { _tag: 'External' },
      senderName: 'Customer',
      senderAddress: 'customer@example.com',
      recipients: [
        {
          kind: 'to',
          position: 0,
          displayName: null,
          address: 'alice@garden.test',
        },
        {
          kind: 'cc',
          position: 0,
          displayName: null,
          address: 'team@garden.test',
        },
      ],
      localRecipients: [
        {
          envelopeAddress: 'alice@garden.test',
          localAddressId: '76721d5f-dfc2-4802-8b2e-a09649305b82',
          providerRecipientId: 'recipient-alice',
          providerEvidence: null,
        },
        {
          envelopeAddress: 'private@garden.test',
          localAddressId: 'be8f4ffb-1839-4dde-8398-73ce9606cde7',
          providerRecipientId: 'recipient-private',
          providerEvidence: null,
        },
      ],
      subject: 'Portfolio update',
      textBody: 'Hello',
      htmlBody: null,
      attachments: [],
      authoredAt: '2026-08-10T10:00:00Z',
      receivedAt: '2026-08-10T10:00:01Z',
    })

    expect(envelope.recipients).toHaveLength(2)
    expect(envelope.localRecipients).toHaveLength(2)
    expect(
      envelope.recipients.map((recipient) => recipient.address),
    ).not.toContain('private@garden.test')
    expect(envelope.providerMessageId).toBe('event-123')
  })

  it('keeps draft edits optimistic and actor-attributed', () => {
    const edit = Schema.decodeUnknownSync(SaveDraftInput)({
      draftId,
      workspaceId,
      actor: { _tag: 'Member', memberId },
      expectedRevision: 4,
      subject: 'Re: Portfolio update',
      textBody: 'Edited by a human',
      htmlBody: null,
      recipients: [],
      attachments: [],
    })

    expect(edit.actor).toEqual({ _tag: 'Member', memberId })
    expect(edit.expectedRevision).toBe(4)
  })

  it('models assignment targets separately from assigning actors', () => {
    const assignment = Schema.decodeUnknownSync(AssignConversationInput)({
      workspaceId,
      conversationId,
      assignee: { _tag: 'Agent', agentId },
      assignedBy: { _tag: 'Member', memberId },
    })

    expect(assignment.assignee._tag).toBe('Agent')
    expect(assignment.assignedBy._tag).toBe('Member')
  })
})
