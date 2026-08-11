import {
  ClaimPendingMailSyncBatchInput,
  CompleteMailSyncRunInput,
  EmailAddress,
  FinalizeMailSyncEnumerationInput,
  ImportedMailEnvelope,
  ListPersonalMailSyncStatesInput,
  MemberId,
  PersistMailSyncPageInput,
  ProviderKey,
  ProviderObjectId,
  ResolveMailSyncAccountInput,
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
) =>
  ImportedMailEnvelope.make({
    workspaceId,
    syncAccountId,
    provider: ProviderKey.make('gmail'),
    providerMessageId: ProviderObjectId.make(providerMessageId),
    providerThreadId: ProviderObjectId.make(providerThreadId),
    providerEvidence: { labelIds: ['INBOX'] },
    rawStorageKey: null,
    internetMessageId: null,
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
            sendCapability: 'read_only',
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
      }).pipe(Effect.provide(makeMailRepositoryLayer(testDb.db))),
  )
})
