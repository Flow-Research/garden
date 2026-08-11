import type { GardenDatabase } from '@garden/db'
import {
  mailMailbox,
  mailMailboxAccess,
  mailSyncAccount,
  mailSyncItem,
  mailSyncRun,
  member,
} from '@garden/db/schema'
import {
  MailSyncAccount,
  MailSyncItem,
  MailSyncRun,
  PersonalMailSyncState,
  type ClaimPendingMailSyncBatchInput,
  type CompleteMailSyncRunInput,
  type FailMailSyncRunInput,
  type FinalizeMailSyncEnumerationInput,
  type ListPersonalMailSyncStatesInput,
  type PersistMailSyncPageInput,
  type ResolveMailSyncAccountInput,
  type SettleMailSyncItemInput,
  type StartMailSyncRunInput,
} from '@garden/core/mail'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { MailRepositoryInvariantError } from './contracts.ts'
import {
  databaseEffect,
  decodeRow,
  inTransaction,
  timestamp,
  type MailDatabase,
} from './shared.ts'

/** Decodes a sync account row into the public Effect contract. */
const decodeSyncAccount = (row: typeof mailSyncAccount.$inferSelect) =>
  decodeRow(
    MailSyncAccount,
    {
      ...row,
      watchExpiration: timestamp(row.watchExpiration),
      lastSyncedAt: timestamp(row.lastSyncedAt),
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
    },
    'mailSync.decodeAccount',
  )

/** Decodes exact progress counts and timestamps from one sync run row. */
const decodeSyncRun = (row: typeof mailSyncRun.$inferSelect) =>
  decodeRow(
    MailSyncRun,
    {
      ...row,
      startedAt: timestamp(row.startedAt),
      completedAt: timestamp(row.completedAt),
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
    },
    'mailSync.decodeRun',
  )

/** Decodes a durable provider work item returned to a Workflow batch step. */
const decodeSyncItem = (row: typeof mailSyncItem.$inferSelect) =>
  decodeRow(
    MailSyncItem,
    {
      ...row,
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
    },
    'mailSync.decodeItem',
  )

/** Resolves a run inside a transaction and rejects cross-workspace calls. */
const requireSyncRun = Effect.fn('MailRepository.requireSyncRun')(function* (
  db: MailDatabase,
  workspaceId: string,
  runId: string,
) {
  const row = (yield* databaseEffect('mailSync.requireRun', () =>
    db
      .select()
      .from(mailSyncRun)
      .where(
        and(
          eq(mailSyncRun.id, runId),
          eq(mailSyncRun.workspaceId, workspaceId),
        ),
      )
      .limit(1),
  ))[0]
  if (row === undefined) {
    return yield* new MailRepositoryInvariantError({
      operation: 'mailSync.requireRun',
      message: 'Mail sync run does not belong to this workspace.',
    })
  }
  return row
})

/**
 * Creates the external mailbox boundary once, then refreshes non-secret
 * Executor connection identity when the same personal Gmail is reconnected.
 */
export const resolveMailSyncAccount = Effect.fn(
  'MailRepository.resolveMailSyncAccount',
)(function* (db: GardenDatabase, input: ResolveMailSyncAccountInput) {
  return yield* inTransaction(db, 'resolveMailSyncAccount', (tx) =>
    Effect.gen(function* () {
      const workspaceMember = (yield* databaseEffect(
        'resolveMailSyncAccount.requireMember',
        () =>
          tx
            .select({ id: member.id })
            .from(member)
            .where(
              and(
                eq(member.id, input.memberId),
                eq(member.userId, input.userId),
                eq(member.organizationId, input.workspaceId),
              ),
            )
            .limit(1),
      ))[0]
      if (workspaceMember === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'resolveMailSyncAccount.requireMember',
          message: 'User is not the supplied workspace member.',
        })
      }

      const existing = (yield* databaseEffect(
        'resolveMailSyncAccount.findExisting',
        () =>
          tx
            .select()
            .from(mailSyncAccount)
            .where(
              and(
                eq(mailSyncAccount.workspaceId, input.workspaceId),
                eq(mailSyncAccount.provider, input.provider),
                eq(mailSyncAccount.providerEmail, input.providerEmail),
              ),
            )
            .limit(1),
      ))[0]
      if (existing !== undefined) {
        if (existing.userId !== input.userId) {
          return yield* new MailRepositoryInvariantError({
            operation: 'resolveMailSyncAccount.findExisting',
            message: 'Connected provider address belongs to another user.',
          })
        }
        yield* databaseEffect('resolveMailSyncAccount.refreshMailbox', () =>
          tx
            .update(mailMailbox)
            .set({
              name: input.mailboxName,
              status: 'active',
              updatedAt: new Date(),
            })
            .where(eq(mailMailbox.id, existing.mailboxId)),
        )
        yield* databaseEffect('resolveMailSyncAccount.ensureAccess', () =>
          tx
            .insert(mailMailboxAccess)
            .values({
              workspaceId: input.workspaceId,
              mailboxId: existing.mailboxId,
              actorType: 'member',
              memberId: input.memberId,
              agentId: null,
              accessLevel: 'owner',
            })
            .onConflictDoNothing(),
        )
        const refreshed = (yield* databaseEffect(
          'resolveMailSyncAccount.refreshAccount',
          () =>
            tx
              .update(mailSyncAccount)
              .set({
                executorIntegration: input.executorIntegration,
                executorConnectionName: input.executorConnectionName,
                status: 'connected',
                lastError: null,
                updatedAt: new Date(),
              })
              .where(eq(mailSyncAccount.id, existing.id))
              .returning(),
        ))[0]
        if (refreshed === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'resolveMailSyncAccount.refreshAccount',
            message: 'Connected mail account disappeared while refreshing.',
          })
        }
        return yield* decodeSyncAccount(refreshed)
      }

      const mailbox = (yield* databaseEffect(
        'resolveMailSyncAccount.createMailbox',
        () =>
          tx
            .insert(mailMailbox)
            .values({
              workspaceId: input.workspaceId,
              name: input.mailboxName,
              kind: 'personal',
              origin: 'external_import',
              status: 'active',
            })
            .returning(),
      ))[0]
      if (mailbox === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'resolveMailSyncAccount.createMailbox',
          message: 'External mailbox was not returned after insert.',
        })
      }
      yield* databaseEffect('resolveMailSyncAccount.createAccess', () =>
        tx.insert(mailMailboxAccess).values({
          workspaceId: input.workspaceId,
          mailboxId: mailbox.id,
          actorType: 'member',
          memberId: input.memberId,
          agentId: null,
          accessLevel: 'owner',
        }),
      )
      const account = (yield* databaseEffect(
        'resolveMailSyncAccount.createAccount',
        () =>
          tx
            .insert(mailSyncAccount)
            .values({
              workspaceId: input.workspaceId,
              mailboxId: mailbox.id,
              userId: input.userId,
              provider: input.provider,
              providerEmail: input.providerEmail,
              executorIntegration: input.executorIntegration,
              executorConnectionName: input.executorConnectionName,
              status: 'connected',
            })
            .returning(),
      ))[0]
      if (account === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'resolveMailSyncAccount.createAccount',
          message: 'Mail sync account was not returned after insert.',
        })
      }
      return yield* decodeSyncAccount(account)
    }),
  )
})

/** Reads the user's provider account and latest durable run for polling UIs. */
export const listPersonalMailSyncStates = Effect.fn(
  'MailRepository.listPersonalMailSyncStates',
)(function* (db: GardenDatabase, input: ListPersonalMailSyncStatesInput) {
  const accounts = yield* databaseEffect(
    'listPersonalMailSyncStates.accounts',
    () =>
      db
        .select()
        .from(mailSyncAccount)
        .where(
          and(
            eq(mailSyncAccount.workspaceId, input.workspaceId),
            eq(mailSyncAccount.userId, input.userId),
            eq(mailSyncAccount.provider, input.provider),
          ),
        )
        .orderBy(desc(mailSyncAccount.updatedAt)),
  )
  return yield* Effect.forEach(accounts, (account) =>
    Effect.gen(function* () {
      const latestRun = (yield* databaseEffect(
        'listPersonalMailSyncStates.latestRun',
        () =>
          db
            .select()
            .from(mailSyncRun)
            .where(eq(mailSyncRun.syncAccountId, account.id))
            .orderBy(desc(mailSyncRun.createdAt))
            .limit(1),
      ))[0]
      return yield* decodeRow(
        PersonalMailSyncState,
        {
          account: yield* decodeSyncAccount(account),
          latestRun:
            latestRun === undefined ? null : yield* decodeSyncRun(latestRun),
        },
        'listPersonalMailSyncStates.decode',
      )
    }),
  )
})

/** Starts once per Workflow id and reuses an already-active account run. */
export const startMailSyncRun = Effect.fn('MailRepository.startMailSyncRun')(
  function* (db: GardenDatabase, input: StartMailSyncRunInput) {
    return yield* inTransaction(db, 'startMailSyncRun', (tx) =>
      Effect.gen(function* () {
        const account = (yield* databaseEffect('startMailSyncRun.account', () =>
          tx
            .select()
            .from(mailSyncAccount)
            .where(
              and(
                eq(mailSyncAccount.id, input.syncAccountId),
                eq(mailSyncAccount.workspaceId, input.workspaceId),
              ),
            )
            .limit(1),
        ))[0]
        if (account === undefined || account.status === 'disconnected') {
          return yield* new MailRepositoryInvariantError({
            operation: 'startMailSyncRun.account',
            message: 'Connected mail sync account was not found.',
          })
        }
        const existing = (yield* databaseEffect(
          'startMailSyncRun.existing',
          () =>
            tx
              .select()
              .from(mailSyncRun)
              .where(
                sql`${mailSyncRun.workflowInstanceId} = ${input.workflowInstanceId} or (${mailSyncRun.syncAccountId} = ${input.syncAccountId} and ${mailSyncRun.status} in ('queued', 'enumerating', 'importing'))`,
              )
              .orderBy(desc(mailSyncRun.createdAt))
              .limit(1),
        ))[0]
        if (existing !== undefined) return yield* decodeSyncRun(existing)
        const created = (yield* databaseEffect('startMailSyncRun.insert', () =>
          tx
            .insert(mailSyncRun)
            .values({
              workspaceId: input.workspaceId,
              syncAccountId: input.syncAccountId,
              workflowInstanceId: input.workflowInstanceId,
              trigger: input.trigger,
              status: 'queued',
              startedAt: new Date(),
            })
            .returning(),
        ))[0]
        if (created === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'startMailSyncRun.insert',
            message: 'Mail sync run was not returned after insert.',
          })
        }
        yield* databaseEffect('startMailSyncRun.markAccountSyncing', () =>
          tx
            .update(mailSyncAccount)
            .set({ status: 'syncing', lastError: null, updatedAt: new Date() })
            .where(eq(mailSyncAccount.id, input.syncAccountId)),
        )
        return yield* decodeSyncRun(created)
      }),
    )
  },
)

/** Persists one enumeration page without duplicating Workflow step retries. */
export const persistMailSyncPage = Effect.fn(
  'MailRepository.persistMailSyncPage',
)(function* (db: GardenDatabase, input: PersistMailSyncPageInput) {
  return yield* inTransaction(db, 'persistMailSyncPage', (tx) =>
    Effect.gen(function* () {
      const run = (yield* databaseEffect('persistMailSyncPage.lockRun', () =>
        tx
          .select()
          .from(mailSyncRun)
          .where(
            and(
              eq(mailSyncRun.id, input.runId),
              eq(mailSyncRun.workspaceId, input.workspaceId),
            ),
          )
          .limit(1)
          .for('update'),
      ))[0]
      if (run === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'persistMailSyncPage.lockRun',
          message: 'Mail sync run does not belong to this workspace.',
        })
      }
      if (!['queued', 'enumerating'].includes(run.status)) {
        return yield* new MailRepositoryInvariantError({
          operation: 'persistMailSyncPage.status',
          message: 'Enumeration page cannot be added after import started.',
        })
      }
      const current =
        (yield* databaseEffect('persistMailSyncPage.currentCount', () =>
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(mailSyncItem)
            .where(eq(mailSyncItem.runId, input.runId)),
        ))[0]?.count ?? 0
      let nextOrdinal = current
      yield* Effect.forEach(
        input.items,
        (item) =>
          Effect.gen(function* () {
            const inserted = yield* databaseEffect(
              'persistMailSyncPage.insertItem',
              () =>
                tx
                  .insert(mailSyncItem)
                  .values({
                    workspaceId: input.workspaceId,
                    runId: input.runId,
                    providerMessageId: item.providerMessageId,
                    providerThreadId: item.providerThreadId,
                    ordinal: nextOrdinal,
                  })
                  .onConflictDoNothing({
                    target: [
                      mailSyncItem.runId,
                      mailSyncItem.providerMessageId,
                    ],
                  })
                  .returning({
                    providerMessageId: mailSyncItem.providerMessageId,
                  }),
            )
            if (inserted.length > 0) nextOrdinal += 1
          }),
        { concurrency: 1 },
      )
      yield* databaseEffect('persistMailSyncPage.markEnumerating', () =>
        tx
          .update(mailSyncRun)
          .set({ status: 'enumerating', updatedAt: new Date() })
          .where(eq(mailSyncRun.id, input.runId)),
      )
      return nextOrdinal
    }),
  )
})

/** Derives and freezes exact total from uniquely persisted provider items. */
export const finalizeMailSyncEnumeration = Effect.fn(
  'MailRepository.finalizeMailSyncEnumeration',
)(function* (db: GardenDatabase, input: FinalizeMailSyncEnumerationInput) {
  return yield* inTransaction(db, 'finalizeMailSyncEnumeration', (tx) =>
    Effect.gen(function* () {
      const run = yield* requireSyncRun(tx, input.workspaceId, input.runId)
      if (run.status === 'importing') {
        return yield* decodeSyncRun(run)
      }
      if (!['queued', 'enumerating'].includes(run.status)) {
        return yield* new MailRepositoryInvariantError({
          operation: 'finalizeMailSyncEnumeration.status',
          message: 'Only an enumerating sync run can freeze its total.',
        })
      }
      const counted = (yield* databaseEffect(
        'finalizeMailSyncEnumeration.count',
        () =>
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(mailSyncItem)
            .where(eq(mailSyncItem.runId, input.runId)),
      ))[0]?.count
      const updated = (yield* databaseEffect(
        'finalizeMailSyncEnumeration.update',
        () =>
          tx
            .update(mailSyncRun)
            .set({
              status: 'importing',
              totalMessages: counted ?? 0,
              updatedAt: new Date(),
            })
            .where(eq(mailSyncRun.id, input.runId))
            .returning(),
      ))[0]
      if (updated === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'finalizeMailSyncEnumeration.update',
          message: 'Sync run disappeared while freezing total.',
        })
      }
      return yield* decodeSyncRun(updated)
    }),
  )
})

/**
 * Claims a stable ordered batch. Retrying the same Workflow step claim key
 * returns its original items, including already-settled ones, for safe replay.
 */
export const claimPendingMailSyncBatch = Effect.fn(
  'MailRepository.claimPendingMailSyncBatch',
)(function* (db: GardenDatabase, input: ClaimPendingMailSyncBatchInput) {
  return yield* inTransaction(db, 'claimPendingMailSyncBatch', (tx) =>
    Effect.gen(function* () {
      const run = yield* requireSyncRun(tx, input.workspaceId, input.runId)
      if (run.status !== 'importing') {
        return yield* new MailRepositoryInvariantError({
          operation: 'claimPendingMailSyncBatch.status',
          message: 'Pending items can only be claimed while importing.',
        })
      }
      let rows = yield* databaseEffect('claimPendingMailSyncBatch.replay', () =>
        tx
          .select()
          .from(mailSyncItem)
          .where(
            and(
              eq(mailSyncItem.runId, input.runId),
              eq(mailSyncItem.claimKey, input.claimKey),
            ),
          )
          .orderBy(asc(mailSyncItem.ordinal)),
      )
      if (rows.length === 0) {
        const pending = yield* databaseEffect(
          'claimPendingMailSyncBatch.lock',
          () =>
            tx
              .select({ providerMessageId: mailSyncItem.providerMessageId })
              .from(mailSyncItem)
              .where(
                and(
                  eq(mailSyncItem.runId, input.runId),
                  eq(mailSyncItem.status, 'pending'),
                ),
              )
              .orderBy(asc(mailSyncItem.ordinal))
              .limit(input.limit)
              .for('update', { skipLocked: true }),
        )
        if (pending.length > 0) {
          rows = yield* databaseEffect('claimPendingMailSyncBatch.update', () =>
            tx
              .update(mailSyncItem)
              .set({
                status: 'processing',
                claimKey: input.claimKey,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(mailSyncItem.runId, input.runId),
                  inArray(
                    mailSyncItem.providerMessageId,
                    pending.map((item) => item.providerMessageId),
                  ),
                  eq(mailSyncItem.status, 'pending'),
                ),
              )
              .returning(),
          )
          rows.sort((left, right) => left.ordinal - right.ordinal)
        }
      }
      return yield* Effect.forEach(rows, decodeSyncItem)
    }),
  )
})

/** Settles one claimed item and increments all visible progress counts atomically. */
export const settleMailSyncItem = Effect.fn(
  'MailRepository.settleMailSyncItem',
)(function* (db: GardenDatabase, input: SettleMailSyncItemInput) {
  return yield* inTransaction(db, 'settleMailSyncItem', (tx) =>
    Effect.gen(function* () {
      const run = yield* requireSyncRun(tx, input.workspaceId, input.runId)
      const item = (yield* databaseEffect('settleMailSyncItem.item', () =>
        tx
          .select()
          .from(mailSyncItem)
          .where(
            and(
              eq(mailSyncItem.runId, input.runId),
              eq(mailSyncItem.providerMessageId, input.providerMessageId),
            ),
          )
          .limit(1)
          .for('update'),
      ))[0]
      if (item === undefined || item.claimKey !== input.claimKey) {
        return yield* new MailRepositoryInvariantError({
          operation: 'settleMailSyncItem.item',
          message: 'Sync item is not owned by this claim.',
        })
      }
      if (item.status !== 'processing') return yield* decodeSyncRun(run)

      const status =
        input.settlement._tag === 'Imported'
          ? ('imported' as const)
          : input.settlement._tag === 'Duplicate'
            ? ('duplicate' as const)
            : ('failed' as const)
      yield* databaseEffect('settleMailSyncItem.settle', () =>
        tx
          .update(mailSyncItem)
          .set({
            status,
            messageId:
              input.settlement._tag === 'Failed'
                ? null
                : input.settlement.messageId,
            error:
              input.settlement._tag === 'Failed'
                ? input.settlement.error
                : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mailSyncItem.runId, input.runId),
              eq(mailSyncItem.providerMessageId, input.providerMessageId),
              eq(mailSyncItem.status, 'processing'),
            ),
          ),
      )
      const updated = (yield* databaseEffect(
        'settleMailSyncItem.increment',
        () =>
          tx
            .update(mailSyncRun)
            .set({
              processedMessages: sql`${mailSyncRun.processedMessages} + 1`,
              importedMessages:
                status === 'imported'
                  ? sql`${mailSyncRun.importedMessages} + 1`
                  : mailSyncRun.importedMessages,
              duplicateMessages:
                status === 'duplicate'
                  ? sql`${mailSyncRun.duplicateMessages} + 1`
                  : mailSyncRun.duplicateMessages,
              failedMessages:
                status === 'failed'
                  ? sql`${mailSyncRun.failedMessages} + 1`
                  : mailSyncRun.failedMessages,
              updatedAt: new Date(),
            })
            .where(eq(mailSyncRun.id, input.runId))
            .returning(),
      ))[0]
      if (updated === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'settleMailSyncItem.increment',
          message: 'Sync run disappeared while settling an item.',
        })
      }
      return yield* decodeSyncRun(updated)
    }),
  )
})

/** Completes only after every exact enumerated item has reached a terminal state. */
export const completeMailSyncRun = Effect.fn(
  'MailRepository.completeMailSyncRun',
)(function* (db: GardenDatabase, input: CompleteMailSyncRunInput) {
  return yield* inTransaction(db, 'completeMailSyncRun', (tx) =>
    Effect.gen(function* () {
      const run = yield* requireSyncRun(tx, input.workspaceId, input.runId)
      if (run.status === 'completed') return yield* decodeSyncRun(run)
      if (
        run.status !== 'importing' ||
        run.totalMessages === null ||
        run.processedMessages !== run.totalMessages
      ) {
        return yield* new MailRepositoryInvariantError({
          operation: 'completeMailSyncRun.progress',
          message: 'Sync run cannot complete before every exact item settles.',
        })
      }
      const now = new Date()
      const updated = (yield* databaseEffect('completeMailSyncRun.update', () =>
        tx
          .update(mailSyncRun)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(mailSyncRun.id, input.runId))
          .returning(),
      ))[0]
      if (updated === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'completeMailSyncRun.update',
          message: 'Sync run disappeared while completing.',
        })
      }
      yield* databaseEffect('completeMailSyncRun.account', () =>
        tx
          .update(mailSyncAccount)
          .set({
            status: 'ready',
            historyId: input.historyId,
            lastSyncedAt: now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(mailSyncAccount.id, run.syncAccountId)),
      )
      return yield* decodeSyncRun(updated)
    }),
  )
})

/** Marks both durable run and connection degraded while preserving progress. */
export const failMailSyncRun = Effect.fn('MailRepository.failMailSyncRun')(
  function* (db: GardenDatabase, input: FailMailSyncRunInput) {
    return yield* inTransaction(db, 'failMailSyncRun', (tx) =>
      Effect.gen(function* () {
        const run = yield* requireSyncRun(tx, input.workspaceId, input.runId)
        if (run.status === 'failed') return yield* decodeSyncRun(run)
        if (run.status === 'completed' || run.status === 'cancelled') {
          return yield* new MailRepositoryInvariantError({
            operation: 'failMailSyncRun.status',
            message: 'A terminal sync run cannot be failed.',
          })
        }
        const now = new Date()
        const updated = (yield* databaseEffect('failMailSyncRun.update', () =>
          tx
            .update(mailSyncRun)
            .set({
              status: 'failed',
              error: input.error,
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(mailSyncRun.id, input.runId))
            .returning(),
        ))[0]
        if (updated === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'failMailSyncRun.update',
            message: 'Sync run disappeared while failing.',
          })
        }
        yield* databaseEffect('failMailSyncRun.account', () =>
          tx
            .update(mailSyncAccount)
            .set({ status: 'degraded', lastError: input.error, updatedAt: now })
            .where(eq(mailSyncAccount.id, run.syncAccountId)),
        )
        return yield* decodeSyncRun(updated)
      }),
    )
  },
)
