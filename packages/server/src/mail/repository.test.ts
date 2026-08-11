import {
  CreateDraftInput,
  DraftId,
  EmailAddress,
  InboundMailEnvelope,
  MailAddressId,
  MailboxId,
  MemberId,
  MessageId,
  InternetMessageId,
  ProviderKey,
  ProviderObjectId,
  SaveDraftInput,
  StorageKey,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import * as tables from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { it } from '@effect/vitest'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  MailDraftRevisionConflictError,
  MailRepository,
  MailRepositoryAccessDeniedError,
  makeMailRepositoryLayer,
} from './repository.ts'

const ids = {
  workspace: '10000000-0000-4000-8000-000000000001',
  userA: '10000000-0000-4000-8000-000000000002',
  userB: '10000000-0000-4000-8000-000000000003',
  memberA: '10000000-0000-4000-8000-000000000004',
  memberB: '10000000-0000-4000-8000-000000000005',
  domain: '10000000-0000-4000-8000-000000000006',
  mailboxA: '10000000-0000-4000-8000-000000000007',
  mailboxB: '10000000-0000-4000-8000-000000000008',
  addressA: '10000000-0000-4000-8000-000000000009',
  addressB: '10000000-0000-4000-8000-000000000010',
  accessA: '10000000-0000-4000-8000-000000000011',
  accessB: '10000000-0000-4000-8000-000000000012',
} as const

const workspaceId = WorkspaceId.make(ids.workspace)
const memberA = {
  _tag: 'Member',
  memberId: MemberId.make(ids.memberA),
} as const
const memberB = {
  _tag: 'Member',
  memberId: MemberId.make(ids.memberB),
} as const

/** Seeds two private mailboxes in one company domain with disjoint membership. */
const seedMailFixture = async (testDb: TestDb): Promise<void> => {
  await testDb.db.insert(tables.user).values([
    { id: ids.userA, email: 'member-a@example.com', name: 'Member A' },
    { id: ids.userB, email: 'member-b@example.com', name: 'Member B' },
  ])
  await testDb.db.insert(tables.organization).values({
    id: ids.workspace,
    name: 'Mail Test',
    slug: 'mail-test',
  })
  await testDb.db.insert(tables.member).values([
    {
      id: ids.memberA,
      organizationId: ids.workspace,
      userId: ids.userA,
      role: 'member',
    },
    {
      id: ids.memberB,
      organizationId: ids.workspace,
      userId: ids.userB,
      role: 'member',
    },
  ])
  await testDb.db.insert(tables.mailDomain).values({
    id: ids.domain,
    workspaceId: ids.workspace,
    name: 'garden.test',
    status: 'active',
    transportProvider: 'test',
  })
  await testDb.db.insert(tables.mailMailbox).values([
    {
      id: ids.mailboxA,
      workspaceId: ids.workspace,
      name: 'Alpha',
      kind: 'shared',
    },
    {
      id: ids.mailboxB,
      workspaceId: ids.workspace,
      name: 'Beta',
      kind: 'shared',
    },
  ])
  await testDb.db.insert(tables.mailAddress).values([
    {
      id: ids.addressA,
      workspaceId: ids.workspace,
      domainId: ids.domain,
      mailboxId: ids.mailboxA,
      localPart: 'alpha',
      kind: 'primary',
    },
    {
      id: ids.addressB,
      workspaceId: ids.workspace,
      domainId: ids.domain,
      mailboxId: ids.mailboxB,
      localPart: 'beta',
      kind: 'primary',
    },
  ])
  await testDb.db.insert(tables.mailMailboxAccess).values([
    {
      id: ids.accessA,
      workspaceId: ids.workspace,
      mailboxId: ids.mailboxA,
      actorType: 'member',
      memberId: ids.memberA,
      accessLevel: 'owner',
    },
    {
      id: ids.accessB,
      workspaceId: ids.workspace,
      mailboxId: ids.mailboxB,
      actorType: 'member',
      memberId: ids.memberB,
      accessLevel: 'owner',
    },
  ])
}

/** Builds a provider event whose private local deliveries never become MIME recipients. */
const inbound = (
  providerMessageId: string,
  localRecipients: ReadonlyArray<{
    readonly localAddressId: string
    readonly envelopeAddress: string
  }>,
  subject = 'Investor update',
) =>
  InboundMailEnvelope.make({
    workspaceId,
    provider: ProviderKey.make('test'),
    providerMessageId: ProviderObjectId.make(providerMessageId),
    providerEvidence: null,
    rawStorageKey: StorageKey.make(`mail/raw/${providerMessageId}.eml`),
    internetMessageId: InternetMessageId.make(
      `<${providerMessageId}@example.com>`,
    ),
    inReplyToMessageId: null,
    referenceMessageIds: [],
    author: { _tag: 'External' },
    senderName: 'Investor',
    senderAddress: EmailAddress.make('investor@example.com'),
    replyTo: [
      {
        position: 0,
        displayName: 'Investor Replies',
        address: EmailAddress.make('replies@example.com'),
      },
    ],
    recipients: [
      {
        kind: 'to',
        position: 0,
        displayName: 'Public list',
        address: EmailAddress.make('public@example.com'),
      },
    ],
    localRecipients: localRecipients.map((recipient, position) => ({
      localAddressId: MailAddressId.make(recipient.localAddressId),
      envelopeAddress: EmailAddress.make(recipient.envelopeAddress),
      providerRecipientId: ProviderObjectId.make(
        `${providerMessageId}-recipient-${position}`,
      ),
      providerEvidence: null,
    })),
    subject,
    textBody: 'Private delivery test.',
    htmlBody: null,
    attachments: [],
    authoredAt: UtcTimestamp.make('2026-08-10T10:00:00.000Z'),
    receivedAt: UtcTimestamp.make('2026-08-10T10:00:01.000Z'),
  })

describe('MailRepository (integration)', () => {
  let testDb: TestDb

  beforeAll(
    async () => {
      testDb = await startTestDb()
      await seedMailFixture(testDb)
    },
    // Match Testcontainers' own startup window. The previous Vitest 10 s
    // default terminated the suite while Postgres was healthy and still
    // applying migrations on a loaded development host.
    60_000,
  )

  afterAll(async () => {
    await testDb?.cleanup()
  }, 60_000)

  it.effect(
    'merges a new local delivery on duplicate ingest without crossing mailbox privacy',
    () =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const first = yield* repository.ingestInbound(
          inbound('provider-duplicate', [
            {
              localAddressId: ids.addressA,
              envelopeAddress: 'alpha@garden.test',
            },
          ]),
        )
        const second = yield* repository.ingestInbound(
          inbound(
            'provider-duplicate',
            [
              {
                localAddressId: ids.addressB,
                envelopeAddress: 'beta@garden.test',
              },
            ],
            'Changed duplicate subject',
          ),
        )

        expect(first.duplicate).toBe(false)
        expect(second.duplicate).toBe(true)
        expect(second.messageId).toBe(first.messageId)
        expect(second.conversationIds).toHaveLength(2)

        const conversationsA = yield* repository.listConversations({
          workspaceId,
          actor: memberA,
          mailboxId: null,
        })
        const conversationsB = yield* repository.listConversations({
          workspaceId,
          actor: memberB,
          mailboxId: null,
        })
        expect(conversationsA).toHaveLength(1)
        expect(conversationsB).toHaveLength(1)
        const conversationA = conversationsA[0]
        const conversationB = conversationsB[0]
        if (conversationA === undefined || conversationB === undefined) {
          return yield* Effect.die('Expected one conversation per mailbox.')
        }
        expect(conversationA).toMatchObject({
          lastSenderName: 'Investor',
          lastSenderAddress: 'investor@example.com',
          lastAuthor: { _tag: 'External' },
          snippet: 'Private delivery test.',
          messageCount: 1,
          unread: true,
          hasDraft: false,
          needsReply: false,
        })

        const detailA = yield* repository.getConversation({
          workspaceId,
          actor: memberA,
          conversationId: conversationA.id,
        })
        expect(detailA.messages).toHaveLength(1)
        expect(detailA.messages[0]?.subject).toBe('Investor update')
        expect(detailA.messages[0]?.replyTo).toEqual([
          {
            position: 0,
            displayName: 'Investor Replies',
            address: 'replies@example.com',
          },
        ])
        expect(detailA.messages[0]?.recipients).toEqual([
          {
            kind: 'to',
            position: 0,
            displayName: 'Public list',
            address: 'public@example.com',
          },
        ])
        expect(JSON.stringify(detailA)).not.toContain('beta@garden.test')
        expect(JSON.stringify(detailA)).not.toContain('mail/raw/')
        const rawRef = yield* repository.getRawMessageContentRef({
          workspaceId,
          actor: memberA,
          conversationId: conversationA.id,
          messageId: detailA.messages[0]!.id,
        })
        expect(rawRef.storageKey).toBe('mail/raw/provider-duplicate.eml')

        const denied = yield* repository
          .getConversation({
            workspaceId,
            actor: memberA,
            conversationId: conversationB.id,
          })
          .pipe(Effect.flip)
        expect(denied).toBeInstanceOf(MailRepositoryAccessDeniedError)
        const deniedContent = yield* repository
          .getRawMessageContentRef({
            workspaceId,
            actor: memberA,
            conversationId: conversationB.id,
            messageId: detailA.messages[0]!.id,
          })
          .pipe(Effect.flip)
        expect(deniedContent).toBeInstanceOf(MailRepositoryAccessDeniedError)

        const counts = yield* Effect.tryPromise(() =>
          Promise.all([
            testDb.db
              .select()
              .from(tables.mailMessage)
              .where(
                and(
                  eq(tables.mailMessage.workspaceId, ids.workspace),
                  eq(
                    tables.mailMessage.ingressProviderMessageId,
                    'provider-duplicate',
                  ),
                ),
              ),
            testDb.db
              .select()
              .from(tables.mailMessageLocalDelivery)
              .where(
                eq(tables.mailMessageLocalDelivery.messageId, first.messageId),
              ),
            testDb.db
              .select()
              .from(tables.mailConversationMessage)
              .where(
                eq(tables.mailConversationMessage.messageId, first.messageId),
              ),
          ]),
        )
        expect(counts[0]).toHaveLength(1)
        expect(counts[1]).toHaveLength(2)
        expect(counts[2]).toHaveLength(2)
      }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )

  it.effect(
    'supports new-conversation drafts and optimistic collaborative saves',
    () =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const created = yield* repository.createDraft(
          CreateDraftInput.make({
            workspaceId,
            mailboxId: MailboxId.make(ids.mailboxA),
            sender: {
              _tag: 'GardenAddress',
              addressId: MailAddressId.make(ids.addressA),
            },
            conversationId: null,
            author: memberA,
            replyToMessageId: null,
            subject: 'New outreach',
            textBody: 'First version',
            htmlBody: null,
            recipients: [
              {
                kind: 'to',
                position: 0,
                displayName: null,
                address: EmailAddress.make('recipient@example.com'),
              },
            ],
            attachments: [],
          }),
        )
        expect(created.conversationId).toBeNull()
        expect(created.revision).toBe(0)

        const saveInput = SaveDraftInput.make({
          draftId: DraftId.make(created.id),
          workspaceId,
          actor: memberA,
          expectedRevision: 0,
          subject: 'New outreach',
          textBody: 'Second version',
          htmlBody: null,
          recipients: created.recipients,
          attachments: [],
        })
        const saved = yield* repository.saveDraft(saveInput)
        expect(saved.revision).toBe(1)
        expect(saved.textBody).toBe('Second version')

        const conflict = yield* repository
          .saveDraft(saveInput)
          .pipe(Effect.flip)
        expect(conflict).toBeInstanceOf(MailDraftRevisionConflictError)
        expect(conflict).toMatchObject({
          expectedRevision: 0,
          actualRevision: 1,
        })

        const approved = yield* repository.transitionDraft({
          workspaceId,
          draftId: saved.id,
          actor: memberA,
          expectedRevision: 1,
          action: 'send_requested',
          toStatus: 'approved',
        })
        expect(approved).toMatchObject({ status: 'approved', revision: 2 })
        const loaded = yield* repository.getDraft({
          workspaceId,
          draftId: saved.id,
          actor: memberA,
        })
        expect(loaded).toMatchObject({ status: 'approved', revision: 2 })
      }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )

  it.effect('keeps state actor-owned and assignments auditable', () =>
    Effect.gen(function* () {
      const repository = yield* MailRepository
      const ingested = yield* repository.ingestInbound(
        inbound('provider-state', [
          {
            localAddressId: ids.addressA,
            envelopeAddress: 'alpha@garden.test',
          },
        ]),
      )
      const conversationId = ingested.conversationIds[0]
      if (conversationId === undefined) {
        return yield* Effect.die('Expected one conversation projection.')
      }
      const state = yield* repository.updateConversationState({
        workspaceId,
        conversationId,
        actor: memberA,
        lastReadMessageId: MessageId.make(ingested.messageId),
        readAt: UtcTimestamp.make('2026-08-10T10:02:00.000Z'),
        archivedAt: UtcTimestamp.make('2026-08-10T10:03:00.000Z'),
        mutedAt: null,
        pinned: true,
      })
      expect(state).toMatchObject({
        lastReadMessageId: ingested.messageId,
        archivedAt: '2026-08-10T10:03:00.000Z',
        pinned: true,
      })
      const readConversations = yield* repository.listConversations({
        workspaceId,
        actor: memberA,
        mailboxId: null,
      })
      expect(
        readConversations.find(
          (conversation) => conversation.id === conversationId,
        ),
      ).toMatchObject({ unread: false, needsReply: true })

      const assigned = yield* repository.assignConversation({
        workspaceId,
        conversationId,
        assignee: memberA,
        assignedBy: memberA,
      })
      expect(assigned.assignee).toEqual(memberA)
      const unassigned = yield* repository.unassignConversation({
        workspaceId,
        conversationId,
        assignee: memberA,
        unassignedBy: memberA,
      })
      expect(unassigned.unassignedAt).not.toBeNull()
    }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )
})
