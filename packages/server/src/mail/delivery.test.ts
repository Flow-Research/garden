import {
  AttachmentId,
  ConversationId,
  CreateDraftInput,
  DraftId,
  EmailAddress,
  MailAddressId,
  MailboxId,
  MemberId,
  MessageId,
  ProviderKey,
  ProviderObjectId,
  RecordDeliveryOutcomeInput,
  RequestDraftDeliveryInput,
  StorageKey,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import * as tables from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { it } from '@effect/vitest'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { sha256 } from './content-addressing.ts'
import { MailDelivery, mailDeliveryLayer } from './delivery.ts'
import { MailObjectStore, testMailObjectStoreLayer } from './object-store.ts'
import { MailRepository, makeMailRepositoryLayer } from './repository.ts'
import {
  MailTransportSendError,
  TestMailTransport,
  testMailTransportLayer,
} from './transport.ts'

const ids = {
  workspace: '30000000-0000-4000-8000-000000000001',
  user: '30000000-0000-4000-8000-000000000002',
  member: '30000000-0000-4000-8000-000000000003',
  domain: '30000000-0000-4000-8000-000000000004',
  mailbox: '30000000-0000-4000-8000-000000000005',
  address: '30000000-0000-4000-8000-000000000006',
  access: '30000000-0000-4000-8000-000000000007',
  attachment: '30000000-0000-4000-8000-000000000008',
  replyConversation: '30000000-0000-4000-8000-000000000009',
  replyMessage: '30000000-0000-4000-8000-000000000010',
} as const

const workspaceId = WorkspaceId.make(ids.workspace)
const actor = {
  _tag: 'Member',
  memberId: MemberId.make(ids.member),
} as const

/** Seeds the minimum real relational authority required for outbound delivery. */
const seedDeliveryFixture = async (testDb: TestDb): Promise<void> => {
  await testDb.db.insert(tables.user).values({
    id: ids.user,
    email: 'sender@garden.test',
    name: 'Sender',
  })
  await testDb.db.insert(tables.organization).values({
    id: ids.workspace,
    name: 'Delivery Test',
    slug: 'delivery-test',
  })
  await testDb.db.insert(tables.member).values({
    id: ids.member,
    organizationId: ids.workspace,
    userId: ids.user,
    role: 'owner',
  })
  await testDb.db.insert(tables.mailDomain).values({
    id: ids.domain,
    workspaceId: ids.workspace,
    name: 'garden.test',
    status: 'active',
    transportProvider: 'test',
  })
  await testDb.db.insert(tables.mailMailbox).values({
    id: ids.mailbox,
    workspaceId: ids.workspace,
    name: 'Investor Relations',
    kind: 'shared',
  })
  await testDb.db.insert(tables.mailAddress).values({
    id: ids.address,
    workspaceId: ids.workspace,
    domainId: ids.domain,
    mailboxId: ids.mailbox,
    localPart: 'investors',
    kind: 'primary',
  })
  await testDb.db.insert(tables.mailMailboxAccess).values({
    id: ids.access,
    workspaceId: ids.workspace,
    mailboxId: ids.mailbox,
    actorType: 'member',
    memberId: ids.member,
    accessLevel: 'owner',
  })
}

/** Builds one memoized dependency graph so test controls inspect the live services. */
const deliveryTestLayer = (testDb: TestDb) => {
  const dependencies = Layer.mergeAll(
    makeMailRepositoryLayer(testDb.db),
    testMailObjectStoreLayer,
    testMailTransportLayer,
  )
  return Layer.mergeAll(
    dependencies,
    mailDeliveryLayer.pipe(Layer.provide(dependencies)),
  )
}

/** Creates an editable new-thread draft and promotes it to approved policy state. */
const createApprovedDraft = Effect.fn('DeliveryTest.createApprovedDraft')(
  function* (
    activeTestDb: TestDb,
    subject: string,
    attachments: CreateDraftInput['attachments'],
    conversationId: ConversationId | null = null,
    replyToMessageId: MessageId | null = null,
  ) {
    const repository = yield* MailRepository
    const draft = yield* repository.createDraft(
      CreateDraftInput.make({
        workspaceId,
        mailboxId: MailboxId.make(ids.mailbox),
        sender: {
          _tag: 'GardenAddress',
          addressId: MailAddressId.make(ids.address),
        },
        conversationId,
        author: actor,
        replyToMessageId,
        subject,
        textBody: 'The attached investor update is ready.',
        htmlBody: '<p>The attached investor update is ready.</p>',
        recipients: [
          {
            kind: 'to',
            position: 0,
            displayName: 'Limited Partner',
            address: EmailAddress.make('lp@example.com'),
          },
        ],
        attachments,
      }),
    )
    yield* Effect.tryPromise(() =>
      activeTestDb.db
        .update(tables.mailDraft)
        .set({ status: 'approved' })
        .where(eq(tables.mailDraft.id, draft.id)),
    )
    return draft
  },
)

describe('MailDelivery (Postgres integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    await seedDeliveryFixture(testDb)
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it.effect(
    'materializes a new thread, verifies attachment bytes, and sends once',
    () =>
      Effect.gen(function* () {
        const delivery = yield* MailDelivery
        const repository = yield* MailRepository
        const store = yield* MailObjectStore
        const transport = yield* TestMailTransport
        const bytes = new TextEncoder().encode('quarterly numbers')
        const contentHash = yield* sha256(bytes)
        const storageKey = StorageKey.make('mail/outbound/quarterly.txt')
        yield* store.put({
          key: storageKey,
          content: bytes,
          contentType: 'text/plain',
        })
        yield* Effect.tryPromise(() =>
          testDb.db.insert(tables.mailAttachment).values({
            id: ids.attachment,
            workspaceId: ids.workspace,
            storageKey,
            fileName: 'quarterly.txt',
            contentType: 'text/plain',
            sizeBytes: bytes.byteLength,
            contentHash,
          }),
        )
        const draft = yield* createApprovedDraft(testDb, 'Quarterly update', [
          {
            attachmentId: AttachmentId.make(ids.attachment),
            disposition: 'attachment',
            contentId: null,
            position: 0,
          },
        ])
        const command = RequestDraftDeliveryInput.make({
          workspaceId,
          draftId: DraftId.make(draft.id),
          actor,
          expectedRevision: 0,
        })

        const sent = yield* delivery.deliver(command)
        expect(sent._tag).toBe('Sent')
        const sentAgain = yield* delivery.deliver(command)
        expect(sentAgain._tag).toBe('AlreadySent')

        const outbound = yield* transport.sentMessages()
        expect(outbound).toHaveLength(1)
        expect(outbound[0]).toMatchObject({
          from: {
            name: 'Investor Relations',
            address: 'investors@garden.test',
          },
          to: [{ name: 'Limited Partner', address: 'lp@example.com' }],
          subject: 'Quarterly update',
          headers: {
            'Message-ID': `<${draft.id}@garden.test>`,
          },
        })
        expect(outbound[0]?.attachments[0]?.content).toEqual(bytes)

        const conversations = yield* repository.listConversations({
          workspaceId,
          actor,
          mailboxId: MailboxId.make(ids.mailbox),
        })
        expect(conversations).toHaveLength(1)
        expect(conversations[0]).toMatchObject({
          id: draft.id,
          lastSenderName: 'Investor Relations',
          lastSenderAddress: 'investors@garden.test',
          snippet: 'The attached investor update is ready.',
          messageCount: 1,
          unread: true,
          hasDraft: false,
          needsReply: false,
        })
        const detail = yield* repository.getConversation({
          workspaceId,
          actor,
          conversationId: conversations[0]!.id,
        })
        expect(JSON.stringify(detail)).not.toContain(storageKey)
        const contentRef = yield* repository.getAttachmentContentRef({
          workspaceId,
          actor,
          conversationId: conversations[0]!.id,
          messageId: detail.messages[0]!.id,
          attachmentId: AttachmentId.make(ids.attachment),
        })
        expect(contentRef.storageKey).toBe(storageKey)

        const [messages, attempts, storedDraft] = yield* Effect.tryPromise(() =>
          Promise.all([
            testDb.db
              .select()
              .from(tables.mailMessage)
              .where(eq(tables.mailMessage.id, draft.id)),
            testDb.db
              .select()
              .from(tables.mailDeliveryAttempt)
              .where(eq(tables.mailDeliveryAttempt.messageId, draft.id)),
            testDb.db
              .select()
              .from(tables.mailDraft)
              .where(eq(tables.mailDraft.id, draft.id)),
          ]),
        )
        expect(messages).toHaveLength(1)
        expect(attempts).toHaveLength(1)
        expect(attempts[0]).toMatchObject({
          status: 'submitted',
          providerAttemptId: `test-${draft.id}@garden.test`,
        })
        expect(storedDraft[0]).toMatchObject({
          status: 'sent',
          sentMessageId: draft.id,
          conversationId: draft.id,
        })
        const outcome = RecordDeliveryOutcomeInput.make({
          workspaceId,
          messageId: MessageId.make(draft.id),
          provider: ProviderKey.make('test'),
          providerAttemptId: ProviderObjectId.make(
            `test-${draft.id}@garden.test`,
          ),
          status: 'delivered',
          failureCode: null,
          failureMessage: null,
          evidence: { event: 'delivered' },
          occurredAt: UtcTimestamp.make('2026-08-10T12:00:00.000Z'),
        })
        yield* repository.recordDeliveryOutcome(outcome)
        yield* repository.recordDeliveryOutcome(outcome)
        const deliveredAttempts = yield* Effect.tryPromise(() =>
          testDb.db
            .select()
            .from(tables.mailDeliveryAttempt)
            .where(eq(tables.mailDeliveryAttempt.messageId, draft.id)),
        )
        expect(deliveredAttempts[0]).toMatchObject({
          status: 'delivered',
          providerEvidence: { event: 'delivered' },
        })
      }).pipe(Effect.provide(deliveryTestLayer(testDb))),
  )

  it.effect(
    'records a failed attempt and retries the immutable message projection',
    () =>
      Effect.gen(function* () {
        const delivery = yield* MailDelivery
        const transport = yield* TestMailTransport
        yield* Effect.tryPromise(() =>
          testDb.db.transaction(async (tx) => {
            await tx.insert(tables.mailConversation).values({
              id: ids.replyConversation,
              workspaceId: ids.workspace,
              mailboxId: ids.mailbox,
              threadKey: 'root@example.com',
              subject: 'Original update',
              normalizedSubject: 'original update',
              lastMessageAt: new Date('2026-08-10T10:00:00.000Z'),
            })
            await tx.insert(tables.mailMessage).values({
              id: ids.replyMessage,
              workspaceId: ids.workspace,
              source: 'inbound',
              authorType: 'external',
              senderName: 'Limited Partner',
              senderAddress: 'lp@example.com',
              subject: 'Original update',
              textBody: 'Please send the revised numbers.',
              htmlBody: null,
              internetMessageId: '<root@example.com>',
              inReplyToMessageId: null,
              referenceMessageIds: ['ancestor@example.com'],
              ingressProvider: 'test',
              ingressProviderMessageId: 'reply-root',
              ingressProviderEvidence: null,
              rawStorageKey: 'mail/raw/reply-root.eml',
              authoredAt: new Date('2026-08-10T10:00:00.000Z'),
            })
            await tx.insert(tables.mailConversationMessage).values({
              workspaceId: ids.workspace,
              conversationId: ids.replyConversation,
              messageId: ids.replyMessage,
            })
          }),
        )
        const draft = yield* createApprovedDraft(
          testDb,
          'Re: Original update',
          [],
          ConversationId.make(ids.replyConversation),
          MessageId.make(ids.replyMessage),
        )
        yield* transport.failNextSend(
          new MailTransportSendError({
            provider: 'test',
            operation: 'send',
            message: 'Temporary provider rejection.',
            code: 'TEMPORARY',
          }),
        )
        const first = yield* delivery.deliver(
          RequestDraftDeliveryInput.make({
            workspaceId,
            draftId: DraftId.make(draft.id),
            actor,
            expectedRevision: 0,
          }),
        )
        expect(first).toMatchObject({
          _tag: 'Failed',
          code: 'TEMPORARY',
          message: 'Temporary provider rejection.',
        })

        const failedDrafts = yield* Effect.tryPromise(() =>
          testDb.db
            .select()
            .from(tables.mailDraft)
            .where(eq(tables.mailDraft.id, draft.id)),
        )
        expect(failedDrafts[0]).toMatchObject({
          status: 'send_failed',
          revision: 2,
        })
        const retried = yield* delivery.deliver(
          RequestDraftDeliveryInput.make({
            workspaceId,
            draftId: DraftId.make(draft.id),
            actor,
            expectedRevision: 2,
          }),
        )
        expect(retried._tag).toBe('Sent')
        const outbound = yield* transport.sentMessages()
        expect(outbound).toHaveLength(1)
        expect(outbound[0]?.headers).toMatchObject({
          'In-Reply-To': '<root@example.com>',
          References: '<ancestor@example.com> <root@example.com>',
        })

        const [messages, attempts] = yield* Effect.tryPromise(() =>
          Promise.all([
            testDb.db
              .select()
              .from(tables.mailMessage)
              .where(eq(tables.mailMessage.id, draft.id)),
            testDb.db
              .select()
              .from(tables.mailDeliveryAttempt)
              .where(eq(tables.mailDeliveryAttempt.messageId, draft.id)),
          ]),
        )
        expect(messages).toHaveLength(1)
        expect(attempts).toHaveLength(2)
        expect(attempts.map((attempt) => attempt.status)).toEqual([
          'failed',
          'submitted',
        ])
      }).pipe(Effect.provide(deliveryTestLayer(testDb))),
  )

  it.effect(
    'reports an already-reserved attempt as in flight without a second send',
    () =>
      Effect.gen(function* () {
        const delivery = yield* MailDelivery
        const repository = yield* MailRepository
        const transport = yield* TestMailTransport
        const draft = yield* createApprovedDraft(
          testDb,
          'Reserved delivery',
          [],
        )
        const command = RequestDraftDeliveryInput.make({
          workspaceId,
          draftId: DraftId.make(draft.id),
          actor,
          expectedRevision: 0,
        })
        const prepared = yield* repository.prepareDraftDelivery(command)
        if (prepared._tag !== 'Ready') {
          return yield* Effect.die(
            'Expected the first reservation to be ready.',
          )
        }
        const inFlight = yield* delivery.deliver(command)
        expect(inFlight._tag).toBe('InFlight')
        expect(yield* transport.sentMessages()).toHaveLength(0)

        const submission = yield* delivery.submitPrepared(prepared.delivery)
        expect(submission._tag).toBe('Accepted')
        expect(yield* transport.sentMessages()).toHaveLength(1)
        const sent = yield* delivery.completePrepared(
          prepared.delivery,
          submission,
        )
        expect(sent._tag).toBe('Sent')
        const completedAgain = yield* delivery.completePrepared(
          prepared.delivery,
          submission,
        )
        expect(completedAgain._tag).toBe('Sent')
        expect(yield* transport.sentMessages()).toHaveLength(1)
      }).pipe(Effect.provide(deliveryTestLayer(testDb))),
  )
})
