import type { GardenDatabase } from '@garden/db'
import {
  mailAddress,
  mailAttachment,
  mailDraft,
  mailDraftActivity,
  mailDraftAttachment,
  mailDraftRecipient,
  mailMailbox,
  mailSyncAccount,
} from '@garden/db/schema'
import {
  DraftId,
  MailboxId,
  type CreateDraftInput,
  type EditableAttachment,
  type EditableRecipient,
  type MailActor,
  type SaveDraftInput,
  type WorkspaceId,
} from '@garden/core/mail'
import { and, eq, inArray, sql } from 'drizzle-orm'
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
  requireConversationAccess,
  requireMailboxAccess,
  storedActor,
  type MailTransaction,
} from './shared.ts'

/** Verifies every referenced immutable attachment belongs to the draft workspace. */
const verifyDraftAttachments = Effect.fn(
  'MailRepository.verifyDraftAttachments',
)(function* (
  tx: MailTransaction,
  workspaceId: WorkspaceId,
  attachments: ReadonlyArray<EditableAttachment>,
  operation: string,
) {
  const ids = [
    ...new Set(attachments.map((attachment) => attachment.attachmentId)),
  ]
  if (ids.length !== attachments.length) {
    return yield* new MailRepositoryInvariantError({
      operation,
      message: 'A draft cannot reference the same attachment more than once.',
    })
  }
  if (ids.length === 0) return
  const rows = yield* databaseEffect(operation, () =>
    tx
      .select({ id: mailAttachment.id })
      .from(mailAttachment)
      .where(
        and(
          eq(mailAttachment.workspaceId, workspaceId),
          inArray(mailAttachment.id, ids),
        ),
      ),
  )
  if (rows.length !== ids.length) {
    return yield* new MailRepositoryInvariantError({
      operation,
      message: 'Draft references an attachment outside its workspace.',
    })
  }
})

/** Replaces draft addressing atomically after optimistic revision succeeds. */
const replaceDraftParts = Effect.fn('MailRepository.replaceDraftParts')(
  function* (
    tx: MailTransaction,
    input: {
      readonly workspaceId: WorkspaceId
      readonly draftId: DraftId
      readonly recipients: ReadonlyArray<EditableRecipient>
      readonly attachments: ReadonlyArray<EditableAttachment>
    },
  ) {
    yield* verifyDraftAttachments(
      tx,
      input.workspaceId,
      input.attachments,
      'replaceDraftParts.verifyAttachments',
    )
    yield* Effect.all([
      databaseEffect('replaceDraftParts.deleteRecipients', () =>
        tx
          .delete(mailDraftRecipient)
          .where(eq(mailDraftRecipient.draftId, input.draftId)),
      ),
      databaseEffect('replaceDraftParts.deleteAttachments', () =>
        tx
          .delete(mailDraftAttachment)
          .where(eq(mailDraftAttachment.draftId, input.draftId)),
      ),
    ])
    if (input.recipients.length > 0) {
      yield* databaseEffect('replaceDraftParts.insertRecipients', () =>
        tx.insert(mailDraftRecipient).values(
          input.recipients.map((recipient) => ({
            workspaceId: input.workspaceId,
            draftId: input.draftId,
            kind: recipient.kind,
            position: recipient.position,
            displayName: recipient.displayName,
            address: recipient.address,
          })),
        ),
      )
    }
    if (input.attachments.length > 0) {
      yield* databaseEffect('replaceDraftParts.insertAttachments', () =>
        tx.insert(mailDraftAttachment).values(
          input.attachments.map((attachment) => ({
            workspaceId: input.workspaceId,
            draftId: input.draftId,
            attachmentId: attachment.attachmentId,
            disposition: attachment.disposition,
            contentId: attachment.contentId,
            position: attachment.position,
          })),
        ),
      )
    }
  },
)

/** Appends the next immutable draft activity after a successful mutation. */
const appendDraftEditActivity = Effect.fn(
  'MailRepository.appendDraftEditActivity',
)(function* (
  tx: MailTransaction,
  input: {
    readonly workspaceId: WorkspaceId
    readonly draftId: DraftId
    readonly actor: MailActor
    readonly revision: number
    readonly action: 'created' | 'edited'
  },
) {
  const actor = storedActor(input.actor)
  const sequenceRows = yield* databaseEffect('draftActivity.nextSequence', () =>
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
      operation: 'draftActivity.nextSequence',
      message: 'Draft activity sequence could not be allocated.',
    })
  }
  yield* databaseEffect('draftActivity.insert', () =>
    tx.insert(mailDraftActivity).values({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      sequence,
      revision: input.revision,
      actorType: actor.actorType,
      memberId: actor.memberId,
      agentId: actor.agentId,
      action: input.action,
      fromStatus: input.action === 'created' ? null : 'editing',
      toStatus: 'editing',
      sentMessageId: null,
    }),
  )
})

/** Creates an editable collaborative draft only inside a writable mailbox. */
export const createDraft = Effect.fn('MailRepository.createDraft')(function* (
  db: GardenDatabase,
  input: CreateDraftInput,
) {
  return yield* inTransaction(db, 'createDraft', (tx) =>
    Effect.gen(function* () {
      yield* requireMailboxAccess(tx, {
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        actor: input.author,
        write: true,
        operation: 'createDraft.authorize',
      })
      if (input.sender._tag === 'GardenAddress') {
        const addressId = input.sender.addressId
        const fromRows = yield* databaseEffect(
          'createDraft.validateGardenSender',
          () =>
            tx
              .select({ id: mailAddress.id, kind: mailAddress.kind })
              .from(mailAddress)
              .innerJoin(
                mailMailbox,
                eq(mailMailbox.id, mailAddress.mailboxId),
              )
              .where(
                and(
                  eq(mailAddress.workspaceId, input.workspaceId),
                  eq(mailAddress.mailboxId, input.mailboxId),
                  eq(mailAddress.id, addressId),
                  eq(mailAddress.status, 'active'),
                  eq(mailMailbox.origin, 'garden_hosted'),
                  eq(mailMailbox.status, 'active'),
                ),
              )
              .limit(1),
        )
        if (fromRows[0] === undefined || fromRows[0].kind === 'catch_all') {
          return yield* new MailRepositoryInvariantError({
            operation: 'createDraft.validateGardenSender',
            message: 'Draft From address is not an active Garden sender.',
          })
        }
      } else {
        const syncAccountId = input.sender.syncAccountId
        const accountRows = yield* databaseEffect(
          'createDraft.validateExternalSender',
          () =>
            tx
              .select({ id: mailSyncAccount.id })
              .from(mailSyncAccount)
              .innerJoin(
                mailMailbox,
                eq(mailMailbox.id, mailSyncAccount.mailboxId),
              )
              .where(
                and(
                  eq(mailSyncAccount.workspaceId, input.workspaceId),
                  eq(mailSyncAccount.mailboxId, input.mailboxId),
                  eq(mailSyncAccount.id, syncAccountId),
                  eq(mailSyncAccount.provider, 'gmail'),
                  inArray(mailSyncAccount.status, [
                    'connected',
                    'syncing',
                    'ready',
                    'degraded',
                  ]),
                  eq(mailMailbox.origin, 'external_import'),
                  eq(mailMailbox.status, 'active'),
                ),
              )
              .limit(1),
        )
        if (accountRows[0] === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'createDraft.validateExternalSender',
            message: 'Draft sender is not an active Gmail account.',
          })
        }
      }
      if (input.conversationId !== null) {
        const conversation = yield* requireConversationAccess(tx, {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          actor: input.author,
          write: true,
          operation: 'createDraft.validateConversation',
        })
        if (conversation.mailboxId !== input.mailboxId) {
          return yield* new MailRepositoryInvariantError({
            operation: 'createDraft.validateConversation',
            message: 'Draft conversation belongs to a different mailbox.',
          })
        }
      } else if (input.replyToMessageId !== null) {
        return yield* new MailRepositoryInvariantError({
          operation: 'createDraft.validateReply',
          message:
            'A new-conversation draft cannot reply to an existing message.',
        })
      }
      const author = storedActor(input.author)
      const inserted = yield* databaseEffect('createDraft.insert', () =>
        tx
          .insert(mailDraft)
          .values({
            workspaceId: input.workspaceId,
            mailboxId: input.mailboxId,
            fromAddressId:
              input.sender._tag === 'GardenAddress'
                ? input.sender.addressId
                : null,
            fromSyncAccountId:
              input.sender._tag === 'ExternalAccount'
                ? input.sender.syncAccountId
                : null,
            conversationId: input.conversationId,
            authorType: author.actorType,
            authorMemberId: author.memberId,
            authorAgentId: author.agentId,
            replyToMessageId: input.replyToMessageId,
            sentMessageId: null,
            status: 'editing',
            revision: 0,
            subject: input.subject,
            textBody: input.textBody,
            htmlBody: input.htmlBody,
          })
          .returning(),
      )
      const draft = inserted[0]
      if (draft === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'createDraft.insert',
          message: 'Draft insert returned no row.',
        })
      }
      yield* replaceDraftParts(tx, {
        workspaceId: input.workspaceId,
        draftId: DraftId.make(draft.id),
        recipients: input.recipients,
        attachments: input.attachments,
      })
      yield* appendDraftEditActivity(tx, {
        workspaceId: input.workspaceId,
        draftId: DraftId.make(draft.id),
        actor: input.author,
        revision: 0,
        action: 'created',
      })
      return yield* loadDraftSnapshot(tx, draft)
    }),
  )
})

/** Saves a draft only when the caller's expected revision is still current. */
export const saveDraft = Effect.fn('MailRepository.saveDraft')(function* (
  db: GardenDatabase,
  input: SaveDraftInput,
) {
  return yield* inTransaction(db, 'saveDraft', (tx) =>
    Effect.gen(function* () {
      const currentRows = yield* databaseEffect('saveDraft.find', () =>
        tx
          .select()
          .from(mailDraft)
          .where(
            and(
              eq(mailDraft.workspaceId, input.workspaceId),
              eq(mailDraft.id, input.draftId),
            ),
          )
          .limit(1),
      )
      const current = currentRows[0]
      if (current === undefined) {
        return yield* new MailRepositoryNotFoundError({
          entity: 'draft',
          id: input.draftId,
          operation: 'saveDraft',
          message: 'Draft does not exist.',
        })
      }
      yield* requireMailboxAccess(tx, {
        workspaceId: input.workspaceId,
        mailboxId: MailboxId.make(current.mailboxId),
        actor: input.actor,
        write: true,
        operation: 'saveDraft.authorize',
      })
      if (current.revision !== input.expectedRevision) {
        return yield* new MailDraftRevisionConflictError({
          draftId: input.draftId,
          expectedRevision: input.expectedRevision,
          actualRevision: current.revision,
          operation: 'saveDraft',
          message: 'Draft was changed by another collaborator.',
        })
      }
      if (current.status !== 'editing') {
        return yield* new MailRepositoryInvariantError({
          operation: 'saveDraft',
          message: 'Only editing drafts can be changed.',
        })
      }
      const updatedRows = yield* databaseEffect('saveDraft.update', () =>
        tx
          .update(mailDraft)
          .set({
            subject: input.subject,
            textBody: input.textBody,
            htmlBody: input.htmlBody,
            revision: sql`${mailDraft.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mailDraft.id, input.draftId),
              eq(mailDraft.revision, input.expectedRevision),
              eq(mailDraft.status, 'editing'),
            ),
          )
          .returning(),
      )
      const updated = updatedRows[0]
      if (updated === undefined) {
        const latest = yield* databaseEffect('saveDraft.findLatest', () =>
          tx
            .select({ revision: mailDraft.revision })
            .from(mailDraft)
            .where(eq(mailDraft.id, input.draftId))
            .limit(1),
        )
        return yield* new MailDraftRevisionConflictError({
          draftId: input.draftId,
          expectedRevision: input.expectedRevision,
          actualRevision: latest[0]?.revision ?? input.expectedRevision,
          operation: 'saveDraft',
          message: 'Draft was changed by another collaborator.',
        })
      }
      yield* replaceDraftParts(tx, {
        workspaceId: input.workspaceId,
        draftId: input.draftId,
        recipients: input.recipients,
        attachments: input.attachments,
      })
      yield* appendDraftEditActivity(tx, {
        workspaceId: input.workspaceId,
        draftId: input.draftId,
        actor: input.actor,
        revision: updated.revision,
        action: 'edited',
      })
      return yield* loadDraftSnapshot(tx, updated)
    }),
  )
})
