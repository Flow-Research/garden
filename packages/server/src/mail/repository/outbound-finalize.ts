import type { GardenDatabase } from '@garden/db'
import { mailDeliveryAttempt, mailDraft } from '@garden/db/schema'
import type { RecordDeliveryOutcomeInput } from '@garden/core/mail'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  MailRepositoryInvariantError,
  MailRepositoryNotFoundError,
  type CompleteDraftDeliveryInput,
  type FailDraftDeliveryInput,
} from './contracts.ts'
import { appendDeliveryActivity } from './outbound.ts'
import { databaseEffect, inTransaction } from './shared.ts'

/** Records provider acceptance and finalizes the draft exactly once. */
export const completeDraftDelivery = Effect.fn(
  'MailRepository.completeDraftDelivery',
)(function* (db: GardenDatabase, input: CompleteDraftDeliveryInput) {
  yield* inTransaction(db, 'completeDraftDelivery', (tx) =>
    Effect.gen(function* () {
      const attempts = yield* databaseEffect(
        'completeDelivery.findAttempt',
        () =>
          tx
            .select()
            .from(mailDeliveryAttempt)
            .where(
              and(
                eq(mailDeliveryAttempt.workspaceId, input.workspaceId),
                eq(mailDeliveryAttempt.id, input.attemptId),
                eq(mailDeliveryAttempt.messageId, input.messageId),
                eq(mailDeliveryAttempt.provider, input.provider),
              ),
            )
            .limit(1)
            .for('update'),
      )
      const attempt = attempts[0]
      if (attempt === undefined) {
        return yield* new MailRepositoryNotFoundError({
          entity: 'deliveryAttempt',
          id: input.attemptId,
          operation: 'completeDraftDelivery',
          message: 'Delivery attempt does not exist.',
        })
      }
      if (attempt.status !== 'queued') {
        if (attempt.providerAttemptId === input.providerMessageId) return
        return yield* new MailRepositoryInvariantError({
          operation: 'completeDraftDelivery',
          message: 'Delivery attempt was already completed differently.',
        })
      }
      const occurredAt = new Date(input.occurredAt)
      yield* databaseEffect('completeDelivery.updateAttempt', () =>
        tx
          .update(mailDeliveryAttempt)
          .set({
            providerAttemptId: input.providerMessageId,
            status: 'submitted',
            submittedAt: occurredAt,
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(mailDeliveryAttempt.id, input.attemptId),
              eq(mailDeliveryAttempt.status, 'queued'),
            ),
          ),
      )
      const drafts = yield* databaseEffect('completeDelivery.findDraft', () =>
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
      const draft = drafts[0]
      if (draft === undefined) {
        return yield* new MailRepositoryNotFoundError({
          entity: 'draft',
          id: input.draftId,
          operation: 'completeDraftDelivery',
          message: 'Draft does not exist.',
        })
      }
      if (draft.status === 'sent' && draft.sentMessageId === input.messageId) {
        return
      }
      if (draft.status !== 'sending') {
        return yield* new MailRepositoryInvariantError({
          operation: 'completeDraftDelivery',
          message: 'Only a sending draft can accept provider acknowledgement.',
        })
      }
      const nextRevision = draft.revision + 1
      yield* databaseEffect('completeDelivery.updateDraft', () =>
        tx
          .update(mailDraft)
          .set({
            status: 'sent',
            sentMessageId: input.messageId,
            revision: nextRevision,
            updatedAt: occurredAt,
          })
          .where(eq(mailDraft.id, input.draftId)),
      )
      yield* appendDeliveryActivity(tx, {
        workspaceId: input.workspaceId,
        draftId: input.draftId,
        actor: { _tag: 'System' },
        revision: nextRevision,
        action: 'sent',
        fromStatus: 'sending',
        toStatus: 'sent',
        sentMessageId: input.messageId,
      })
    }),
  )
})

/** Records a failed network attempt and makes the immutable message retryable. */
export const failDraftDelivery = Effect.fn('MailRepository.failDraftDelivery')(
  function* (db: GardenDatabase, input: FailDraftDeliveryInput) {
    yield* inTransaction(db, 'failDraftDelivery', (tx) =>
      Effect.gen(function* () {
        const attempts = yield* databaseEffect('failDelivery.findAttempt', () =>
          tx
            .select()
            .from(mailDeliveryAttempt)
            .where(
              and(
                eq(mailDeliveryAttempt.workspaceId, input.workspaceId),
                eq(mailDeliveryAttempt.id, input.attemptId),
                eq(mailDeliveryAttempt.messageId, input.messageId),
                eq(mailDeliveryAttempt.provider, input.provider),
              ),
            )
            .limit(1)
            .for('update'),
        )
        const attempt = attempts[0]
        if (attempt === undefined) {
          return yield* new MailRepositoryNotFoundError({
            entity: 'deliveryAttempt',
            id: input.attemptId,
            operation: 'failDraftDelivery',
            message: 'Delivery attempt does not exist.',
          })
        }
        if (attempt.status === 'failed') return
        if (attempt.status !== 'queued') {
          return yield* new MailRepositoryInvariantError({
            operation: 'failDraftDelivery',
            message: 'Provider-accepted delivery cannot be marked failed.',
          })
        }
        const occurredAt = new Date(input.occurredAt)
        yield* databaseEffect('failDelivery.updateAttempt', () =>
          tx
            .update(mailDeliveryAttempt)
            .set({
              status: 'failed',
              failureCode: input.failureCode,
              failureMessage: input.failureMessage,
              completedAt: occurredAt,
              updatedAt: occurredAt,
            })
            .where(eq(mailDeliveryAttempt.id, input.attemptId)),
        )
        const drafts = yield* databaseEffect('failDelivery.findDraft', () =>
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
        const draft = drafts[0]
        if (draft === undefined) {
          return yield* new MailRepositoryNotFoundError({
            entity: 'draft',
            id: input.draftId,
            operation: 'failDraftDelivery',
            message: 'Draft does not exist.',
          })
        }
        if (draft.status === 'send_failed') return
        if (draft.status !== 'sending') {
          return yield* new MailRepositoryInvariantError({
            operation: 'failDraftDelivery',
            message: 'Only a sending draft can record delivery failure.',
          })
        }
        const nextRevision = draft.revision + 1
        yield* databaseEffect('failDelivery.updateDraft', () =>
          tx
            .update(mailDraft)
            .set({
              status: 'send_failed',
              revision: nextRevision,
              updatedAt: occurredAt,
            })
            .where(eq(mailDraft.id, input.draftId)),
        )
        yield* appendDeliveryActivity(tx, {
          workspaceId: input.workspaceId,
          draftId: input.draftId,
          actor: { _tag: 'System' },
          revision: nextRevision,
          action: 'send_failed',
          fromStatus: 'sending',
          toStatus: 'send_failed',
          sentMessageId: null,
        })
      }),
    )
  },
)

/** Applies an asynchronous provider delivery/bounce outcome idempotently. */
export const recordDeliveryOutcome = Effect.fn(
  'MailRepository.recordDeliveryOutcome',
)(function* (db: GardenDatabase, input: RecordDeliveryOutcomeInput) {
  const rows = yield* databaseEffect('recordDeliveryOutcome.find', () =>
    db
      .select()
      .from(mailDeliveryAttempt)
      .where(
        and(
          eq(mailDeliveryAttempt.workspaceId, input.workspaceId),
          eq(mailDeliveryAttempt.messageId, input.messageId),
          eq(mailDeliveryAttempt.provider, input.provider),
          eq(mailDeliveryAttempt.providerAttemptId, input.providerAttemptId),
        ),
      )
      .limit(1),
  )
  const attempt = rows[0]
  if (attempt === undefined) {
    return yield* new MailRepositoryNotFoundError({
      entity: 'deliveryAttempt',
      id: input.providerAttemptId,
      operation: 'recordDeliveryOutcome',
      message: 'Provider delivery attempt does not exist.',
    })
  }
  if (attempt.status === input.status) return
  const occurredAt = new Date(input.occurredAt)
  yield* databaseEffect('recordDeliveryOutcome.update', () =>
    db
      .update(mailDeliveryAttempt)
      .set({
        status: input.status,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        providerEvidence: input.evidence,
        completedAt:
          input.status === 'delivered' ||
          input.status === 'bounced' ||
          input.status === 'failed'
            ? occurredAt
            : null,
        updatedAt: occurredAt,
      })
      .where(eq(mailDeliveryAttempt.id, attempt.id)),
  )
})
