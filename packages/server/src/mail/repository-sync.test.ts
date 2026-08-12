import {
  ClaimPendingMailSyncBatchInput,
  CancelMailSyncRunInput,
  CompleteMailSyncRunInput,
  CreateDraftInput,
  DraftId,
  EmailAddress,
  FailMailSyncRunInput,
  FinalizeMailSyncEnumerationInput,
  ImportedMailEnvelope,
  InternetMessageId,
  ListPersonalMailSyncStatesInput,
  MemberId,
  MessageId,
  PersistMailSyncPageInput,
  ProviderKey,
  ProviderObjectId,
  ResolveMailSyncAccountInput,
  RequestDraftDeliveryInput,
  SettleMailSyncItemInput,
  StartMailSyncRunInput,
  UserId,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import * as tables from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { it } from '@effect/vitest'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { MailRepository, makeMailRepositoryLayer } from './repository.ts'

const ids = {
  workspace: '20000000-0000-4000-8000-000000000001',
  user: '20000000-0000-4000-8000-000000000002',
  member: '20000000-0000-4000-8000-000000000003',
} as const

const workspaceId = WorkspaceId.make(ids.workspace)
const userId = UserId.make(ids.user)
const memberId = MemberId.make(ids.member)
const actor = { _tag: 'Member', memberId } as const

/** Seeds only identity/workspace rows; the sync repository owns mailbox creation. */
const seedSyncFixture = async (testDb: TestDb): Promise<void> => {
  await testDb.db.insert(tables.user).values({
    id: ids.user,
    email: 'sync-owner@example.com',
    name: 'Sync Owner',
  })
  await testDb.db.insert(tables.organization).values({
    id: ids.workspace,
    name: 'Sync Test',
    slug: 'sync-test',
  })
  await testDb.db.insert(tables.member).values({
    id: ids.member,
    organizationId: ids.workspace,
    userId: ids.user,
    role: 'owner',
  })
}

/** Produces parsed imported content for one enumerated Gmail work item. */
const importedEnvelope = (
  syncAccountId: Parameters<
    typeof ImportedMailEnvelope.make
  >[0]['syncAccountId'],
  providerMessageId: string,
  providerThreadId = 'gmail-thread-1',
  internetMessageId: string | null = null,
  labelIds: ReadonlyArray<string> = ['INBOX'],
) =>
  ImportedMailEnvelope.make({
    workspaceId,
    syncAccountId,
    provider: ProviderKey.make('gmail'),
    providerMessageId: ProviderObjectId.make(providerMessageId),
    providerThreadId: ProviderObjectId.make(providerThreadId),
    providerEvidence: { labelIds: [...labelIds] },
    rawStorageKey: null,
    internetMessageId:
      internetMessageId === null
        ? null
        : InternetMessageId.make(internetMessageId),
    inReplyToMessageId: null,
    referenceMessageIds: [],
    author: { _tag: 'External' },
    senderName: 'Investor',
    senderAddress: EmailAddress.make('investor@example.com'),
    replyTo: [],
    recipients: [
      {
        kind: 'to',
        position: 0,
        displayName: 'Personal Gmail',
        address: EmailAddress.make('kixeyems0@gmail.com'),
      },
    ],
    subject: 'Imported investor note',
    textBody: 'Imported from Gmail.',
    htmlBody: null,
    attachments: [],
    authoredAt: UtcTimestamp.make('2026-08-11T10:00:00.000Z'),
  })

describe('MailRepository Gmail sync ledger (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    await seedSyncFixture(testDb)
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it.effect(
    'owns an external mailbox and settles exact retry-safe import progress',
    () =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const account = yield* repository.resolveMailSyncAccount(
          ResolveMailSyncAccountInput.make({
            workspaceId,
            userId,
            memberId,
            provider: 'gmail',
            providerEmail: EmailAddress.make('kixeyems0@gmail.com'),
            mailboxName: 'Personal Gmail',
            executorIntegration: 'gmail',
            executorConnectionName: 'kixeyems0@gmail.com',
          }),
        )
        const resolvedAgain = yield* repository.resolveMailSyncAccount(
          ResolveMailSyncAccountInput.make({
            workspaceId,
            userId,
            memberId,
            provider: 'gmail',
            providerEmail: EmailAddress.make('kixeyems0@gmail.com'),
            mailboxName: 'Personal Gmail',
            executorIntegration: 'gmail',
            executorConnectionName: 'kixeyems0@gmail.com',
          }),
        )
        expect(resolvedAgain.id).toBe(account.id)

        const mailboxes = yield* repository.listMailboxes({
          workspaceId,
          actor,
        })
        expect(mailboxes).toEqual([
          expect.objectContaining({
            id: account.mailboxId,
            origin: 'external_import',
            primaryAddress: null,
            externalAddress: 'kixeyems0@gmail.com',
            sendCapability: 'gmail_transport',
          }),
        ])

        const run = yield* repository.startMailSyncRun(
          StartMailSyncRunInput.make({
            workspaceId,
            syncAccountId: account.id,
            workflowInstanceId: 'gmail-import-workflow-1',
            trigger: 'initial',
          }),
        )
        const sameRun = yield* repository.startMailSyncRun(
          StartMailSyncRunInput.make({
            workspaceId,
            syncAccountId: account.id,
            workflowInstanceId: 'gmail-import-workflow-1',
            trigger: 'initial',
          }),
        )
        expect(sameRun.id).toBe(run.id)

        yield* repository.persistMailSyncPage(
          PersistMailSyncPageInput.make({
            workspaceId,
            runId: run.id,
            items: [
              {
                providerMessageId: ProviderObjectId.make('gmail-message-1'),
                providerThreadId: ProviderObjectId.make('gmail-thread-1'),
              },
              {
                providerMessageId: ProviderObjectId.make('gmail-message-1'),
                providerThreadId: ProviderObjectId.make('gmail-thread-1'),
              },
              {
                providerMessageId: ProviderObjectId.make('gmail-message-2'),
                providerThreadId: ProviderObjectId.make('gmail-thread-1'),
              },
            ],
          }),
        )
        yield* repository.persistMailSyncPage(
          PersistMailSyncPageInput.make({
            workspaceId,
            runId: run.id,
            items: [
              {
                providerMessageId: ProviderObjectId.make('gmail-message-1'),
                providerThreadId: ProviderObjectId.make('gmail-thread-1'),
              },
              {
                providerMessageId: ProviderObjectId.make('gmail-message-2'),
                providerThreadId: ProviderObjectId.make('gmail-thread-1'),
              },
            ],
          }),
        )
        yield* repository.finalizeMailSyncEnumeration(
          FinalizeMailSyncEnumerationInput.make({
            workspaceId,
            runId: run.id,
          }),
        )
        const batch = yield* repository.claimPendingMailSyncBatch(
          ClaimPendingMailSyncBatchInput.make({
            workspaceId,
            runId: run.id,
            claimKey: 'workflow-step-batch-1',
            limit: 20,
          }),
        )
        expect(batch.map((item) => item.providerMessageId)).toEqual([
          'gmail-message-1',
          'gmail-message-2',
        ])

        const first = yield* repository.ingestImported(
          importedEnvelope(account.id, 'gmail-message-1'),
        )
        expect(first.duplicate).toBe(false)
        yield* repository.settleMailSyncItem(
          SettleMailSyncItemInput.make({
            workspaceId,
            runId: run.id,
            providerMessageId: ProviderObjectId.make('gmail-message-1'),
            claimKey: 'workflow-step-batch-1',
            settlement: { _tag: 'Imported', messageId: first.messageId },
          }),
        )

        const second = yield* repository.ingestImported(
          importedEnvelope(account.id, 'gmail-message-2'),
        )
        const secondReplay = yield* repository.ingestImported(
          importedEnvelope(account.id, 'gmail-message-2'),
        )
        expect(secondReplay).toMatchObject({
          duplicate: true,
          messageId: second.messageId,
        })
        const settled = yield* repository.settleMailSyncItem(
          SettleMailSyncItemInput.make({
            workspaceId,
            runId: run.id,
            providerMessageId: ProviderObjectId.make('gmail-message-2'),
            claimKey: 'workflow-step-batch-1',
            settlement: { _tag: 'Duplicate', messageId: second.messageId },
          }),
        )
        expect(settled).toMatchObject({
          totalMessages: 2,
          processedMessages: 2,
          importedMessages: 1,
          duplicateMessages: 1,
          failedMessages: 0,
        })

        const replayedBatch = yield* repository.claimPendingMailSyncBatch(
          ClaimPendingMailSyncBatchInput.make({
            workspaceId,
            runId: run.id,
            claimKey: 'workflow-step-batch-1',
            limit: 20,
          }),
        )
        expect(replayedBatch.map((item) => item.status)).toEqual([
          'imported',
          'duplicate',
        ])

        const completed = yield* repository.completeMailSyncRun(
          CompleteMailSyncRunInput.make({
            workspaceId,
            runId: run.id,
            historyId: ProviderObjectId.make('gmail-history-10'),
          }),
        )
        expect(completed.status).toBe('completed')
        const states = yield* repository.listPersonalMailSyncStates(
          ListPersonalMailSyncStatesInput.make({
            workspaceId,
            userId,
            provider: 'gmail',
          }),
        )
        const state = states[0]
        expect(state?.account).toMatchObject({
          id: account.id,
          status: 'ready',
          historyId: 'gmail-history-10',
        })
        expect(state?.latestRun).toMatchObject({
          id: run.id,
          status: 'completed',
          processedMessages: 2,
        })

        const importedMessages = yield* Effect.tryPromise(() =>
          testDb.db
            .select()
            .from(tables.mailMessage)
            .where(eq(tables.mailMessage.source, 'imported')),
        )
        expect(importedMessages).toHaveLength(2)
        expect(
          importedMessages.every((message) => message.rawStorageKey === null),
        ).toBe(true)

        yield* repository.ingestImported(
          importedEnvelope(
            account.id,
            'gmail-message-1',
            'gmail-thread-1',
            null,
            ['STARRED'],
          ),
        )
        yield* repository.ingestImported(
          importedEnvelope(
            account.id,
            'gmail-message-2',
            'gmail-thread-1',
            null,
            [],
          ),
        )
        const archived = yield* repository.listConversations({
          workspaceId,
          actor,
          mailboxId: account.mailboxId,
        })
        expect(archived[0]).toMatchObject({
          unread: false,
          state: { pinned: true },
        })
        expect(archived[0]?.state?.archivedAt).not.toBeNull()

        yield* repository.ingestImported(
          importedEnvelope(
            account.id,
            'gmail-message-2',
            'gmail-thread-1',
            null,
            ['UNREAD'],
          ),
        )
        const unread = yield* repository.listConversations({
          workspaceId,
          actor,
          mailboxId: account.mailboxId,
        })
        expect(unread[0]).toMatchObject({
          unread: true,
          state: { pinned: true },
        })
      }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )

  it.effect(
    'resumes a frozen failed workset without enumerating Gmail again',
    () =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const account = yield* repository.resolveMailSyncAccount(
          ResolveMailSyncAccountInput.make({
            workspaceId,
            userId,
            memberId,
            provider: 'gmail',
            providerEmail: EmailAddress.make('resume@gmail.com'),
            mailboxName: 'Recovery Gmail',
            executorIntegration: 'google_gmail',
            executorConnectionName: 'recovery',
          }),
        )
        const original = yield* repository.startMailSyncRun(
          StartMailSyncRunInput.make({
            workspaceId,
            syncAccountId: account.id,
            workflowInstanceId: 'gmail-recovery-original',
            trigger: 'initial',
          }),
        )
        yield* repository.persistMailSyncPage(
          PersistMailSyncPageInput.make({
            workspaceId,
            runId: original.id,
            items: [
              {
                providerMessageId: ProviderObjectId.make('recovery-message-1'),
                providerThreadId: ProviderObjectId.make('recovery-thread'),
              },
              {
                providerMessageId: ProviderObjectId.make('recovery-message-2'),
                providerThreadId: ProviderObjectId.make('recovery-thread'),
              },
              {
                providerMessageId: ProviderObjectId.make('recovery-message-3'),
                providerThreadId: ProviderObjectId.make('recovery-thread'),
              },
            ],
          }),
        )
        yield* repository.finalizeMailSyncEnumeration(
          FinalizeMailSyncEnumerationInput.make({
            workspaceId,
            runId: original.id,
          }),
        )
        const claimed = yield* repository.claimPendingMailSyncBatch(
          ClaimPendingMailSyncBatchInput.make({
            workspaceId,
            runId: original.id,
            claimKey: 'interrupted-batch',
            limit: 2,
          }),
        )
        const firstItem = claimed[0]
        if (firstItem === undefined) {
          return yield* Effect.die('Expected recovery fixture work item.')
        }
        const firstMessage = yield* repository.ingestImported(
          importedEnvelope(account.id, firstItem.providerMessageId),
        )
        yield* repository.settleMailSyncItem(
          SettleMailSyncItemInput.make({
            workspaceId,
            runId: original.id,
            providerMessageId: firstItem.providerMessageId,
            claimKey: 'interrupted-batch',
            settlement: {
              _tag: 'Imported',
              messageId: firstMessage.messageId,
            },
          }),
        )
        yield* repository.failMailSyncRun(
          FailMailSyncRunInput.make({
            workspaceId,
            runId: original.id,
            error: 'Hyperdrive tunnel disconnected.',
          }),
        )

        const resumed = yield* repository.startMailSyncRun(
          StartMailSyncRunInput.make({
            workspaceId,
            syncAccountId: account.id,
            workflowInstanceId: 'gmail-recovery-resumed',
            trigger: 'manual',
          }),
        )

        expect(resumed).toMatchObject({
          id: original.id,
          workflowInstanceId: 'gmail-recovery-resumed',
          trigger: 'recovery',
          status: 'importing',
          totalMessages: 3,
          processedMessages: 1,
          importedMessages: 1,
          failedMessages: 0,
          error: null,
        })
        const recoveredStates = yield* repository.listPersonalMailSyncStates(
          ListPersonalMailSyncStatesInput.make({
            workspaceId,
            userId,
            provider: 'gmail',
          }),
        )
        expect(
          recoveredStates.find((state) => state.account?.id === account.id)
            ?.latestRun?.id,
        ).toBe(original.id)
        const remaining = yield* repository.claimPendingMailSyncBatch(
          ClaimPendingMailSyncBatchInput.make({
            workspaceId,
            runId: resumed.id,
            claimKey: 'recovered-batch',
            limit: 10,
          }),
        )
        expect(remaining.map((item) => item.providerMessageId)).toEqual([
          'recovery-message-2',
          'recovery-message-3',
        ])
      }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )

  it.effect('cancels and resumes the same frozen workset', () =>
    Effect.gen(function* () {
      const repository = yield* MailRepository
      const account = yield* repository.resolveMailSyncAccount(
        ResolveMailSyncAccountInput.make({
          workspaceId,
          userId,
          memberId,
          provider: 'gmail',
          providerEmail: EmailAddress.make('paused@gmail.com'),
          mailboxName: 'Paused Gmail',
          executorIntegration: 'google_gmail',
          executorConnectionName: 'paused',
        }),
      )
      const original = yield* repository.startMailSyncRun(
        StartMailSyncRunInput.make({
          workspaceId,
          syncAccountId: account.id,
          workflowInstanceId: 'gmail-pause-original',
          trigger: 'initial',
        }),
      )
      yield* repository.persistMailSyncPage(
        PersistMailSyncPageInput.make({
          workspaceId,
          runId: original.id,
          items: [
            {
              providerMessageId: ProviderObjectId.make('paused-message'),
              providerThreadId: ProviderObjectId.make('paused-thread'),
            },
          ],
        }),
      )
      yield* repository.finalizeMailSyncEnumeration(
        FinalizeMailSyncEnumerationInput.make({
          workspaceId,
          runId: original.id,
        }),
      )
      yield* repository.claimPendingMailSyncBatch(
        ClaimPendingMailSyncBatchInput.make({
          workspaceId,
          runId: original.id,
          claimKey: 'paused-claim',
          limit: 1,
        }),
      )

      const cancelled = yield* repository.cancelMailSyncRun(
        CancelMailSyncRunInput.make({ workspaceId, runId: original.id }),
      )
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        processedMessages: 0,
        totalMessages: 1,
      })

      const resumed = yield* repository.startMailSyncRun(
        StartMailSyncRunInput.make({
          workspaceId,
          syncAccountId: account.id,
          workflowInstanceId: 'gmail-pause-resumed',
          trigger: 'manual',
        }),
      )
      expect(resumed).toMatchObject({
        id: original.id,
        status: 'importing',
        trigger: 'recovery',
        workflowInstanceId: 'gmail-pause-resumed',
      })
      const remaining = yield* repository.claimPendingMailSyncBatch(
        ClaimPendingMailSyncBatchInput.make({
          workspaceId,
          runId: original.id,
          claimKey: 'resumed-claim',
          limit: 1,
        }),
      )
      expect(remaining.map((item) => item.providerMessageId)).toEqual([
        'paused-message',
      ])
    }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )

  it.effect(
    'reserves a Gmail reply with the real account and provider thread route',
    () =>
      Effect.gen(function* () {
        const repository = yield* MailRepository
        const account = yield* repository.resolveMailSyncAccount(
          ResolveMailSyncAccountInput.make({
            workspaceId,
            userId,
            memberId,
            provider: 'gmail',
            providerEmail: EmailAddress.make('kixeyems0@gmail.com'),
            mailboxName: 'Personal Gmail',
            executorIntegration: 'google_gmail',
            executorConnectionName: 'kixeyems0@gmail.com',
          }),
        )
        const ingested = yield* repository.ingestImported(
          importedEnvelope(
            account.id,
            'gmail-outbound-source',
            'gmail-outbound-thread',
            'original@example.com',
          ),
        )
        const conversationId = ingested.conversationIds[0]
        if (conversationId === undefined) {
          return yield* Effect.die('Expected imported Gmail conversation.')
        }
        const draft = yield* repository.createDraft(
          CreateDraftInput.make({
            workspaceId,
            mailboxId: account.mailboxId,
            sender: {
              _tag: 'ExternalAccount',
              syncAccountId: account.id,
            },
            conversationId,
            author: actor,
            replyToMessageId: MessageId.make(ingested.messageId),
            subject: 'Re: Imported investor note',
            textBody: 'Thanks for the update.',
            htmlBody: null,
            recipients: [
              {
                kind: 'to',
                position: 0,
                displayName: 'Investor',
                address: EmailAddress.make('investor@example.com'),
              },
            ],
            attachments: [],
          }),
        )
        yield* Effect.tryPromise(() =>
          testDb.db
            .update(tables.mailDraft)
            .set({ status: 'approved' })
            .where(eq(tables.mailDraft.id, draft.id)),
        )
        const preparation = yield* repository.prepareDraftDelivery(
          RequestDraftDeliveryInput.make({
            workspaceId,
            draftId: DraftId.make(draft.id),
            actor,
            expectedRevision: 0,
          }),
        )
        expect(preparation._tag).toBe('Ready')
        if (preparation._tag !== 'Ready') return
        expect(preparation.delivery).toMatchObject({
          provider: 'gmail',
          from: { address: 'kixeyems0@gmail.com' },
          route: {
            _tag: 'Gmail',
            syncAccountId: account.id,
            userId,
            executorIntegration: 'google_gmail',
            executorConnectionName: 'kixeyems0@gmail.com',
            threadId: 'gmail-outbound-thread',
          },
          inReplyToMessageId: 'original@example.com',
          referenceMessageIds: ['original@example.com'],
        })
        const storedMessage = yield* Effect.tryPromise(() =>
          testDb.db
            .select()
            .from(tables.mailMessage)
            .where(eq(tables.mailMessage.id, draft.id)),
        )
        expect(storedMessage[0]).toMatchObject({
          senderAddressId: null,
          senderSyncAccountId: account.id,
          senderAddress: 'kixeyems0@gmail.com',
        })
      }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )
})
