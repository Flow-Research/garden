import type { GardenDatabase } from '@garden/db'
import { mailDraft, mailDraftActivity } from '@garden/db/schema'
import { MailboxId, type TransitionDraftInput } from '@garden/core/mail'
import { and, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  MailDraftRevisionConflictError,
  MailRepositoryInvariantError,
  MailRepositoryNotFoundError,
} from './contracts.ts'
import { loadDraftSnapshot } from './queries.ts'
import {
  databaseEffect,
  inTransaction,
  requireMailboxAccess,
  storedActionActor,
} from './shared.ts'

/**
 * Persists one already-decided application transition and immutable activity in
 * the same transaction. The application service owns legal transition policy;
 * this boundary owns optimistic revision and mailbox authorization.
 */
export const transitionDraft = Effect.fn('MailRepository.transitionDraft')(
  function* (db: GardenDatabase, input: TransitionDraftInput) {
    return yield* inTransaction(db, 'transitionDraft', (tx) =>
      Effect.gen(function* () {
        const rows = yield* databaseEffect('transitionDraft.find', () =>
          tx
            .select()
            .from(mailDraft)
            .where(
              and(
                eq(mailDraft.workspaceId, input.workspaceId),
                eq(mailDraft.id, input.draftId),
              ),
            )
            .limit(1)
            .for('update'),
        )
        const draft = rows[0]
        if (!draft) {
          return yield* new MailRepositoryNotFoundError({
            entity: 'draft',
            id: input.draftId,
            operation: 'transitionDraft',
            message: 'Draft does not exist.',
          })
        }
        if (input.actor._tag !== 'System') {
          yield* requireMailboxAccess(tx, {
            workspaceId: input.workspaceId,
            mailboxId: MailboxId.make(draft.mailboxId),
            actor: input.actor,
            write: true,
            operation: 'transitionDraft.authorize',
          })
        }
        if (draft.revision !== input.expectedRevision) {
          return yield* new MailDraftRevisionConflictError({
            draftId: input.draftId,
            expectedRevision: input.expectedRevision,
            actualRevision: draft.revision,
            operation: 'transitionDraft',
            message: 'Draft changed before its status transition.',
          })
        }
        const sequenceRows = yield* databaseEffect(
          'transitionDraft.nextSequence',
          () =>
            tx
              .select({
                sequence: sql<number>`coalesce(max(${mailDraftActivity.sequence}), 0) + 1`,
              })
              .from(mailDraftActivity)
              .where(eq(mailDraftActivity.draftId, input.draftId)),
        )
        const sequence = sequenceRows[0]?.sequence
        if (sequence === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'transitionDraft.nextSequence',
            message: 'Draft activity sequence could not be allocated.',
          })
        }
        const revision = draft.revision + 1
        const occurredAt = new Date()
        const actor = storedActionActor(input.actor)
        yield* databaseEffect('transitionDraft.update', () =>
          tx
            .update(mailDraft)
            .set({
              status: input.toStatus,
              revision,
              updatedAt: occurredAt,
            })
            .where(eq(mailDraft.id, input.draftId)),
        )
        yield* databaseEffect('transitionDraft.activity', () =>
          tx.insert(mailDraftActivity).values({
            workspaceId: input.workspaceId,
            draftId: input.draftId,
            sequence,
            revision,
            actorType: actor.actorType,
            memberId: actor.memberId,
            agentId: actor.agentId,
            action: input.action,
            fromStatus: draft.status,
            toStatus: input.toStatus,
            sentMessageId: null,
            createdAt: occurredAt,
          }),
        )
        return yield* loadDraftSnapshot(tx, {
          ...draft,
          status: input.toStatus,
          revision,
          updatedAt: occurredAt,
        })
      }),
    )
  },
)
