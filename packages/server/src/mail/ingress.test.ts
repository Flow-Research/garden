import {
  ConversationId,
  EmailAddress,
  IngestedMail,
  MailAddressId,
  MailDomainId,
  MailboxId,
  MessageId,
  WorkspaceId,
} from '@garden/core/mail'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { ingestNormalizedMail } from './ingress.ts'
import type { NormalizedInboundMail } from './model.ts'
import {
  TestMailObjectStore,
  testMailObjectStoreLayer,
} from './object-store.ts'
import { MailRepository, type MailRepositoryService } from './repository.ts'

const workspaceId = WorkspaceId.make('72f55ab1-3383-47f9-bf34-4132f934bb89')
const domainId = MailDomainId.make('2dc6eb02-f4f3-4164-8ec4-21a5f6f67fa8')
const localAddressId = MailAddressId.make(
  'e11d3c09-c813-4057-8690-90bc1f28656a',
)
const mailboxId = MailboxId.make('01dfb6c5-d1df-492a-a7c7-738a045e5ee7')
const ingested = IngestedMail.make({
  messageId: MessageId.make('0660b5b4-7d7e-4d91-a423-4b0ab93f6f08'),
  conversationIds: [
    ConversationId.make('980388f8-b356-4fc6-bb9d-414a87350faf'),
  ],
  duplicate: false,
})

/** Representative event proves SMTP routing remains separate from MIME recipients. */
const inboundMail = (): NormalizedInboundMail => {
  const raw = new TextEncoder().encode(
    [
      'From: Alice Investor <alice@example.com>',
      'To: Public Team <team@garden.example>',
      'Reply-To: Alice Replies <reply@example.com>',
      'Subject: Portfolio update',
      'Message-ID: <portfolio-1@example.com>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="mail"',
      '',
      '--mail',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'The update is attached.',
      '--mail',
      'Content-Type: text/plain; name="update.txt"',
      'Content-Disposition: attachment; filename="update.txt"',
      '',
      'attachment body',
      '--mail--',
      '',
    ].join('\r\n'),
  )

  return {
    envelopeFrom: 'bounce@example.com',
    envelopeTo: 'hidden@garden.example',
    headers: [{ name: 'x-provider', value: 'cloudflare' }],
    raw,
    rawSize: raw.byteLength,
  }
}

/** Supplies only ingress operations; unrelated repository methods remain defects. */
const repositoryLayer = (
  captured: Ref.Ref<unknown | null>,
): Layer.Layer<MailRepository> => {
  const unavailable = () => Effect.die(new Error('unused repository operation'))
  const service: MailRepositoryService = {
    listMailboxes: unavailable,
    listConversations: unavailable,
    listConversationPage: unavailable,
    getConversation: unavailable,
    getDraft: unavailable,
    resolveDraftSender: unavailable,
    getRawMessageContentRef: unavailable,
    getAttachmentContentRef: unavailable,
    resolveLocalAddress: () =>
      Effect.succeed({
        workspaceId,
        domainId,
        localAddressId,
        mailboxId,
        addressKind: 'primary',
        matchedBy: 'exact',
        envelopeAddress: EmailAddress.make('hidden@garden.example'),
      }),
    ingestInbound: (envelope) =>
      Ref.set(captured, envelope).pipe(Effect.as(ingested)),
    ingestImported: unavailable,
    resolveMailSyncAccount: unavailable,
    listPersonalMailSyncStates: unavailable,
    startMailSyncRun: unavailable,
    persistMailSyncPage: unavailable,
    finalizeMailSyncEnumeration: unavailable,
    claimPendingMailSyncBatch: unavailable,
    settleMailSyncItem: unavailable,
    completeMailSyncRun: unavailable,
    failMailSyncRun: unavailable,
    cancelMailSyncRun: unavailable,
    createDraft: unavailable,
    saveDraft: unavailable,
    transitionDraft: unavailable,
    prepareDraftDelivery: unavailable,
    completeDraftDelivery: unavailable,
    failDraftDelivery: unavailable,
    recordDeliveryOutcome: unavailable,
    updateConversationState: unavailable,
    assignConversation: unavailable,
    unassignConversation: unavailable,
  }
  return Layer.succeed(MailRepository, MailRepository.of(service))
}

describe('MailIngress', () => {
  it.effect(
    'stores exact content and passes a private resolved delivery to persistence',
    () =>
      Effect.gen(function* () {
        const captured = yield* Ref.make<unknown | null>(null)
        const dependencies = Layer.merge(
          repositoryLayer(captured),
          testMailObjectStoreLayer,
        )

        yield* Effect.gen(function* () {
          const result = yield* ingestNormalizedMail(inboundMail())
          const envelope = yield* Ref.get(captured)
          const objects = yield* (yield* TestMailObjectStore).objects()

          expect(result).toEqual(ingested)
          expect(envelope).toMatchObject({
            workspaceId,
            provider: 'cloudflare-email-service',
            internetMessageId: 'portfolio-1@example.com',
            senderAddress: 'alice@example.com',
            replyTo: [{ address: 'reply@example.com' }],
            recipients: [{ kind: 'to', address: 'team@garden.example' }],
            localRecipients: [
              {
                localAddressId,
                envelopeAddress: 'hidden@garden.example',
              },
            ],
          })
          expect(objects).toHaveLength(2)
          expect(objects.map((object) => object.contentType)).toEqual([
            'text/plain',
            'message/rfc822',
          ])
          expect(
            objects.every((object) =>
              object.key.startsWith(`mail/${workspaceId}/`),
            ),
          ).toBe(true)
        }).pipe(Effect.provide(dependencies))
      }),
  )
})
