import type { GardenDatabase } from '@garden/db'
import {
  mailAddress,
  mailAttachment,
  mailConversation,
  mailConversationMessage,
  mailDeliveryAttempt,
  mailDomain,
  mailDraft,
  mailDraftActivity,
  mailDraftAttachment,
  mailDraftRecipient,
  mailMailbox,
  mailMessage,
  mailMessageAttachment,
  mailRecipient,
  mailSyncAccount,
} from '@garden/db/schema'
import {
  ConversationId,
  DeliveryAttemptId,
  DraftId,
  MailboxId,
  MessageId,
  ProviderObjectId,
  type MailActor,
} from '@garden/core/mail'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  DeliveryPreparation,
  MailDraftRevisionConflictError,
  MailRepositoryInvariantError,
  MailRepositoryNotFoundError,
  PreparedDelivery,
  type PrepareDraftDeliveryInput,
} from './contracts.ts'
import {
  databaseEffect,
  decodeRow,
  inTransaction,
  requireMailboxAccess,
  storedActor,
  type MailTransaction,
} from './shared.ts'

/** Recovers Gmail's opaque thread id only from the account-namespaced key we own. */
const gmailThreadId = (
  threadKey: string,
  syncAccountId: string,
): string | null => {
  const prefix = `gmail:${syncAccountId}:`
  return threadKey.startsWith(prefix) && threadKey.length > prefix.length
    ? threadKey.slice(prefix.length)
    : null
}

/** Appends a delivery lifecycle event inside the same transaction as its state. */
export const appendDeliveryActivity = Effect.fn(
  'MailRepository.appendDeliveryActivity',
)(function* (
  tx: MailTransaction,
  input: {
    readonly draftId: string
    readonly workspaceId: string
    readonly actor: MailActor | { readonly _tag: 'System' }
    readonly revision: number
    readonly action:
      | 'send_requested'
      | 'retry_requested'
      | 'send_failed'
      | 'sent'
    readonly fromStatus: 'approved' | 'send_failed' | 'sending'
    readonly toStatus: 'sending' | 'send_failed' | 'sent'
    readonly sentMessageId: string | null
  },
) {
  const sequenceRows = yield* databaseEffect(
    'deliveryActivity.nextSequence',
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
      operation: 'deliveryActivity.nextSequence',
      message: 'Draft delivery activity sequence could not be allocated.',
    })
  }
  const actor =
    input.actor._tag === 'System'
      ? { actorType: 'system' as const, memberId: null, agentId: null }
      : storedActor(input.actor)
  yield* databaseEffect('deliveryActivity.insert', () =>
    tx.insert(mailDraftActivity).values({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      sequence,
      revision: input.revision,
      actorType: actor.actorType,
      memberId: actor.memberId,
      agentId: actor.agentId,
      action: input.action,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      sentMessageId: input.sentMessageId,
    }),
  )
})

/** Loads the immutable message and attachment metadata needed by a network step. */
const loadPreparedDelivery = Effect.fn('MailRepository.loadPreparedDelivery')(
  function* (
    tx: MailTransaction,
    input: {
      readonly workspaceId: string
      readonly draftId: string
      readonly messageId: string
      readonly conversationId: string
      readonly attempt: typeof mailDeliveryAttempt.$inferSelect
    },
  ) {
    const messageRows = yield* databaseEffect(
      'prepareDelivery.loadMessage',
      () =>
        tx
          .select({
            message: mailMessage,
            localPart: mailAddress.localPart,
            domainName: mailDomain.name,
            mailboxName: mailMailbox.name,
            account: mailSyncAccount,
            threadKey: mailConversation.threadKey,
          })
          .from(mailMessage)
          .leftJoin(
            mailAddress,
            eq(mailAddress.id, mailMessage.senderAddressId),
          )
          .leftJoin(mailDomain, eq(mailDomain.id, mailAddress.domainId))
          .leftJoin(
            mailSyncAccount,
            eq(mailSyncAccount.id, mailMessage.senderSyncAccountId),
          )
          .innerJoin(
            mailConversation,
            eq(mailConversation.id, input.conversationId),
          )
          .innerJoin(
            mailMailbox,
            eq(mailMailbox.id, mailConversation.mailboxId),
          )
          .where(
            and(
              eq(mailMessage.workspaceId, input.workspaceId),
              eq(mailMessage.id, input.messageId),
            ),
          )
          .limit(1),
    )
    const row = messageRows[0]
    if (row === undefined || row.message.internetMessageId === null) {
      return yield* new MailRepositoryInvariantError({
        operation: 'prepareDelivery.loadMessage',
        message: 'Materialized outbound message is incomplete.',
      })
    }
    const hasGardenSender =
      row.message.senderAddressId !== null &&
      row.localPart !== null &&
      row.domainName !== null
    const hasGmailSender =
      row.message.senderSyncAccountId !== null && row.account !== null
    if (hasGardenSender === hasGmailSender) {
      return yield* new MailRepositoryInvariantError({
        operation: 'prepareDelivery.loadSender',
        message: 'Materialized outbound sender identity is invalid.',
      })
    }
    const route =
      row.account !== null && row.message.senderSyncAccountId !== null
        ? {
            _tag: 'Gmail' as const,
            provider: 'gmail' as const,
            syncAccountId: row.account.id,
            userId: row.account.userId,
            executorIntegration: row.account.executorIntegration,
            executorConnectionName: row.account.executorConnectionName,
            threadId: (() => {
              const value = gmailThreadId(row.threadKey, row.account.id)
              return value === null ? null : ProviderObjectId.make(value)
            })(),
          }
        : {
            _tag: 'GardenHosted' as const,
            provider: input.attempt.provider,
          }
    const [recipients, attachments] = yield* Effect.all([
      databaseEffect('prepareDelivery.loadRecipients', () =>
        tx
          .select()
          .from(mailRecipient)
          .where(eq(mailRecipient.messageId, input.messageId))
          .orderBy(asc(mailRecipient.kind), asc(mailRecipient.position)),
      ),
      databaseEffect('prepareDelivery.loadAttachments', () =>
        tx
          .select({
            reference: mailMessageAttachment,
            attachment: mailAttachment,
          })
          .from(mailMessageAttachment)
          .innerJoin(
            mailAttachment,
            eq(mailAttachment.id, mailMessageAttachment.attachmentId),
          )
          .where(eq(mailMessageAttachment.messageId, input.messageId))
          .orderBy(asc(mailMessageAttachment.position)),
      ),
    ])
    const addresses = (kind: 'to' | 'cc' | 'bcc') =>
      recipients
        .filter((recipient) => recipient.kind === kind)
        .map((recipient) => ({
          displayName: recipient.displayName,
          address: recipient.address,
        }))
    const to = addresses('to')
    if (to.length === 0) {
      return yield* new MailRepositoryInvariantError({
        operation: 'prepareDelivery.loadRecipients',
        message: 'Outbound delivery requires at least one To recipient.',
      })
    }
    if (
      attachments.some(
        ({ reference }) =>
          reference.disposition === 'inline' && reference.contentId === null,
      )
    ) {
      return yield* new MailRepositoryInvariantError({
        operation: 'prepareDelivery.loadAttachments',
        message: 'Inline outbound attachments require a content id.',
      })
    }
    return yield* decodeRow(
      PreparedDelivery,
      {
        workspaceId: input.workspaceId,
        draftId: input.draftId,
        messageId: input.messageId,
        conversationId: input.conversationId,
        attemptId: input.attempt.id,
        attemptNumber: input.attempt.attemptNumber,
        provider: input.attempt.provider,
        route,
        from: {
          displayName: row.mailboxName,
          address: row.message.senderAddress,
        },
        to,
        cc: addresses('cc'),
        bcc: addresses('bcc'),
        subject: row.message.subject,
        textBody: row.message.textBody,
        htmlBody: row.message.htmlBody,
        internetMessageId: row.message.internetMessageId,
        inReplyToMessageId: row.message.inReplyToMessageId,
        referenceMessageIds: row.message.referenceMessageIds,
        attachments: attachments.map(({ reference, attachment }) => ({
          storageKey: attachment.storageKey,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          contentHash: attachment.contentHash,
          disposition: reference.disposition,
          contentId: reference.contentId,
          position: reference.position,
        })),
      },
      'prepareDelivery.decode',
    )
  },
)

/** Materializes a first outbound message with deterministic draft-derived identity. */
const materializeFirstDelivery = Effect.fn(
  'MailRepository.materializeFirstDelivery',
)(function* (
  tx: MailTransaction,
  draft: typeof mailDraft.$inferSelect,
  input: PrepareDraftDeliveryInput,
) {
  const fromAddressId = draft.fromAddressId
  const fromSyncAccountId = draft.fromSyncAccountId
  const gardenSourceRows =
    fromAddressId === null
      ? []
      : yield* databaseEffect('prepareDelivery.loadGardenSource', () =>
          tx
            .select({
              localPart: mailAddress.localPart,
              domainName: mailDomain.name,
              provider: mailDomain.transportProvider,
              mailboxName: mailMailbox.name,
              addressKind: mailAddress.kind,
            })
            .from(mailAddress)
            .innerJoin(mailDomain, eq(mailDomain.id, mailAddress.domainId))
            .innerJoin(mailMailbox, eq(mailMailbox.id, mailAddress.mailboxId))
            .where(
              and(
                eq(mailAddress.workspaceId, input.workspaceId),
                eq(mailAddress.id, fromAddressId),
                eq(mailAddress.mailboxId, draft.mailboxId),
                eq(mailAddress.status, 'active'),
                eq(mailDomain.status, 'active'),
                eq(mailMailbox.origin, 'garden_hosted'),
                eq(mailMailbox.status, 'active'),
              ),
            )
            .limit(1),
        )
  const externalSourceRows =
    fromSyncAccountId === null
      ? []
      : yield* databaseEffect('prepareDelivery.loadExternalSource', () =>
          tx
            .select({
              account: mailSyncAccount,
              mailboxName: mailMailbox.name,
            })
            .from(mailSyncAccount)
            .innerJoin(
              mailMailbox,
              eq(mailMailbox.id, mailSyncAccount.mailboxId),
            )
            .where(
              and(
                eq(mailSyncAccount.workspaceId, input.workspaceId),
                eq(mailSyncAccount.id, fromSyncAccountId),
                eq(mailSyncAccount.mailboxId, draft.mailboxId),
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
  const gardenSource = gardenSourceRows[0]
  const externalSource = externalSourceRows[0]
  if (
    (gardenSource === undefined) === (externalSource === undefined) ||
    gardenSource?.addressKind === 'catch_all'
  ) {
    return yield* new MailRepositoryInvariantError({
      operation: 'prepareDelivery.loadSource',
      message: 'Draft sender is not one active outbound identity.',
    })
  }
  const source =
    gardenSource === undefined
      ? {
          provider: externalSource?.account.provider,
          senderName: externalSource?.mailboxName,
          senderAddress: externalSource?.account.providerEmail,
          internetMessageDomain:
            externalSource?.account.providerEmail.split('@')[1],
        }
      : {
          provider: gardenSource.provider,
          senderName: gardenSource.mailboxName,
          senderAddress: `${gardenSource.localPart}@${gardenSource.domainName}`,
          internetMessageDomain: gardenSource.domainName,
        }
  if (
    source.provider === undefined ||
    source.senderName === undefined ||
    source.senderAddress === undefined ||
    source.internetMessageDomain === undefined ||
    source.internetMessageDomain.length === 0
  ) {
    return yield* new MailRepositoryInvariantError({
      operation: 'prepareDelivery.resolveSource',
      message: 'Draft sender metadata is incomplete.',
    })
  }
  const { provider, senderName, senderAddress, internetMessageDomain } = source
  const recipients = yield* databaseEffect(
    'prepareDelivery.loadDraftRecipients',
    () =>
      tx
        .select()
        .from(mailDraftRecipient)
        .where(eq(mailDraftRecipient.draftId, draft.id))
        .orderBy(
          asc(mailDraftRecipient.kind),
          asc(mailDraftRecipient.position),
        ),
  )
  if (!recipients.some((recipient) => recipient.kind === 'to')) {
    return yield* new MailRepositoryInvariantError({
      operation: 'prepareDelivery.loadDraftRecipients',
      message: 'Outbound delivery requires at least one To recipient.',
    })
  }
  const draftAttachments = yield* databaseEffect(
    'prepareDelivery.loadDraftAttachments',
    () =>
      tx
        .select()
        .from(mailDraftAttachment)
        .where(eq(mailDraftAttachment.draftId, draft.id))
        .orderBy(asc(mailDraftAttachment.position)),
  )
  const messageId = MessageId.make(draft.id)
  const internetMessageId = `${draft.id}@${internetMessageDomain}`
  const replyToMessageId = draft.replyToMessageId
  const replyRows =
    replyToMessageId === null
      ? []
      : yield* databaseEffect('prepareDelivery.loadReplyMessage', () =>
          tx
            .select()
            .from(mailMessage)
            .where(
              and(
                eq(mailMessage.workspaceId, input.workspaceId),
                eq(mailMessage.id, replyToMessageId),
              ),
            )
            .limit(1),
        )
  const reply = replyRows[0]
  if (replyToMessageId !== null && reply === undefined) {
    return yield* new MailRepositoryInvariantError({
      operation: 'prepareDelivery.loadReplyMessage',
      message: 'Draft reply target does not exist.',
    })
  }
  const references = [
    ...(reply?.referenceMessageIds ?? []),
    ...(reply?.internetMessageId === null ||
    reply?.internetMessageId === undefined
      ? []
      : [reply.internetMessageId]),
  ].filter((value, index, values) => values.indexOf(value) === index)
  const now = new Date()
  yield* databaseEffect('prepareDelivery.insertMessage', () =>
    tx.insert(mailMessage).values({
      id: messageId,
      workspaceId: input.workspaceId,
      source: 'outbound',
      authorType: draft.authorType,
      authorMemberId: draft.authorMemberId,
      authorAgentId: draft.authorAgentId,
      senderAddressId: draft.fromAddressId,
      senderSyncAccountId: draft.fromSyncAccountId,
      senderName,
      senderAddress,
      subject: draft.subject,
      textBody: draft.textBody,
      htmlBody: draft.htmlBody,
      internetMessageId,
      inReplyToMessageId: reply?.internetMessageId ?? null,
      referenceMessageIds: references,
      replyToMessageId: draft.replyToMessageId,
      ingressProvider: null,
      ingressProviderMessageId: null,
      ingressProviderEvidence: null,
      rawStorageKey: null,
      authoredAt: now,
    }),
  )
  if (recipients.length > 0) {
    yield* databaseEffect('prepareDelivery.insertRecipients', () =>
      tx.insert(mailRecipient).values(
        recipients.map((recipient) => ({
          workspaceId: input.workspaceId,
          messageId,
          kind: recipient.kind,
          position: recipient.position,
          displayName: recipient.displayName,
          address: recipient.address,
        })),
      ),
    )
  }
  if (draftAttachments.length > 0) {
    yield* databaseEffect('prepareDelivery.linkAttachments', () =>
      tx.insert(mailMessageAttachment).values(
        draftAttachments.map((attachment) => ({
          workspaceId: input.workspaceId,
          messageId,
          attachmentId: attachment.attachmentId,
          disposition: attachment.disposition,
          contentId: attachment.contentId,
          position: attachment.position,
        })),
      ),
    )
  }

  const conversationId =
    draft.conversationId === null
      ? ConversationId.make(draft.id)
      : ConversationId.make(draft.conversationId)
  if (draft.conversationId === null) {
    yield* databaseEffect('prepareDelivery.insertConversation', () =>
      tx.insert(mailConversation).values({
        id: conversationId,
        workspaceId: input.workspaceId,
        mailboxId: draft.mailboxId,
        threadKey: internetMessageId,
        subject: draft.subject,
        normalizedSubject: draft.subject.trim().toLowerCase(),
        lastMessageAt: now,
      }),
    )
  }
  yield* databaseEffect('prepareDelivery.projectMessage', () =>
    tx.insert(mailConversationMessage).values({
      workspaceId: input.workspaceId,
      conversationId,
      messageId,
    }),
  )
  yield* databaseEffect('prepareDelivery.updateConversation', () =>
    tx
      .update(mailConversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(mailConversation.id, conversationId)),
  )
  return { messageId, conversationId, provider }
})

/** Reserves one durable queued attempt and moves the draft into sending. */
const reserveAttempt = Effect.fn('MailRepository.reserveAttempt')(function* (
  tx: MailTransaction,
  input: PrepareDraftDeliveryInput,
  draft: typeof mailDraft.$inferSelect,
  messageId: MessageId,
  conversationId: ConversationId,
  provider: string,
) {
  const attempts = yield* databaseEffect('prepareDelivery.nextAttempt', () =>
    tx
      .select({
        attemptNumber: sql<number>`coalesce(max(${mailDeliveryAttempt.attemptNumber}), 0) + 1`,
      })
      .from(mailDeliveryAttempt)
      .where(eq(mailDeliveryAttempt.messageId, messageId)),
  )
  const attemptNumber = attempts[0]?.attemptNumber
  if (attemptNumber === undefined) {
    return yield* new MailRepositoryInvariantError({
      operation: 'prepareDelivery.nextAttempt',
      message: 'Delivery attempt number could not be allocated.',
    })
  }
  const inserted = yield* databaseEffect('prepareDelivery.insertAttempt', () =>
    tx
      .insert(mailDeliveryAttempt)
      .values({
        workspaceId: input.workspaceId,
        messageId,
        attemptNumber,
        provider,
        status: 'queued',
      })
      .returning(),
  )
  const attempt = inserted[0]
  if (attempt === undefined) {
    return yield* new MailRepositoryInvariantError({
      operation: 'prepareDelivery.insertAttempt',
      message: 'Delivery attempt insert returned no row.',
    })
  }
  const nextRevision = draft.revision + 1
  const fromStatus = draft.status === 'approved' ? 'approved' : 'send_failed'
  const updated = yield* databaseEffect('prepareDelivery.updateDraft', () =>
    tx
      .update(mailDraft)
      .set({
        conversationId,
        status: 'sending',
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailDraft.id, draft.id),
          eq(mailDraft.revision, draft.revision),
          eq(mailDraft.status, draft.status),
        ),
      )
      .returning(),
  )
  if (updated[0] === undefined) {
    return yield* new MailDraftRevisionConflictError({
      draftId: DraftId.make(draft.id),
      expectedRevision: draft.revision,
      actualRevision: draft.revision,
      operation: 'prepareDelivery.updateDraft',
      message: 'Draft delivery was concurrently changed.',
    })
  }
  yield* appendDeliveryActivity(tx, {
    workspaceId: input.workspaceId,
    draftId: draft.id,
    actor: input.actor,
    revision: nextRevision,
    action: fromStatus === 'approved' ? 'send_requested' : 'retry_requested',
    fromStatus,
    toStatus: 'sending',
    sentMessageId: null,
  })
  return yield* loadPreparedDelivery(tx, {
    workspaceId: input.workspaceId,
    draftId: draft.id,
    messageId,
    conversationId,
    attempt,
  })
})

/** Atomically materializes/reserves a send or reports its durable prior state. */
export const prepareDraftDelivery = Effect.fn(
  'MailRepository.prepareDraftDelivery',
)(function* (db: GardenDatabase, input: PrepareDraftDeliveryInput) {
  return yield* inTransaction(db, 'prepareDraftDelivery', (tx) =>
    Effect.gen(function* () {
      const rows = yield* databaseEffect('prepareDelivery.findDraft', () =>
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
      if (draft === undefined) {
        return yield* new MailRepositoryNotFoundError({
          entity: 'draft',
          id: input.draftId,
          operation: 'prepareDraftDelivery',
          message: 'Draft does not exist.',
        })
      }
      yield* requireMailboxAccess(tx, {
        workspaceId: input.workspaceId,
        mailboxId: MailboxId.make(draft.mailboxId),
        actor: input.actor,
        write: true,
        operation: 'prepareDraftDelivery.authorize',
      })
      const messageId = MessageId.make(draft.id)
      if (draft.status === 'sent') {
        if (draft.sentMessageId === null || draft.conversationId === null) {
          return yield* new MailRepositoryInvariantError({
            operation: 'prepareDraftDelivery.sent',
            message: 'Sent draft is missing its immutable message projection.',
          })
        }
        const sentMessageId = draft.sentMessageId
        const sentConversationId = draft.conversationId
        const receipts = yield* databaseEffect(
          'prepareDelivery.findReceipt',
          () =>
            tx
              .select()
              .from(mailDeliveryAttempt)
              .where(eq(mailDeliveryAttempt.messageId, sentMessageId))
              .orderBy(desc(mailDeliveryAttempt.attemptNumber))
              .limit(1),
        )
        return DeliveryPreparation.cases.AlreadySent.make({
          draftId: input.draftId,
          messageId: MessageId.make(sentMessageId),
          conversationId: ConversationId.make(sentConversationId),
          providerMessageId:
            receipts[0]?.providerAttemptId === null ||
            receipts[0]?.providerAttemptId === undefined
              ? null
              : ProviderObjectId.make(receipts[0].providerAttemptId),
        })
      }
      if (draft.status === 'sending') {
        if (draft.conversationId === null) {
          return yield* new MailRepositoryInvariantError({
            operation: 'prepareDraftDelivery.inFlight',
            message: 'Sending draft is missing its conversation projection.',
          })
        }
        const queued = yield* databaseEffect('prepareDelivery.findQueued', () =>
          tx
            .select()
            .from(mailDeliveryAttempt)
            .where(
              and(
                eq(mailDeliveryAttempt.messageId, messageId),
                eq(mailDeliveryAttempt.status, 'queued'),
              ),
            )
            .orderBy(desc(mailDeliveryAttempt.attemptNumber))
            .limit(1),
        )
        const attempt = queued[0]
        if (attempt === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'prepareDraftDelivery.inFlight',
            message: 'Sending draft has no queued delivery attempt.',
          })
        }
        return DeliveryPreparation.cases.InFlight.make({
          draftId: input.draftId,
          messageId,
          conversationId: ConversationId.make(draft.conversationId),
          attemptId: DeliveryAttemptId.make(attempt.id),
        })
      }
      if (draft.status !== 'approved' && draft.status !== 'send_failed') {
        return yield* new MailRepositoryInvariantError({
          operation: 'prepareDraftDelivery.status',
          message: 'Draft must be approved before delivery can begin.',
        })
      }
      if (draft.revision !== input.expectedRevision) {
        return yield* new MailDraftRevisionConflictError({
          draftId: input.draftId,
          expectedRevision: input.expectedRevision,
          actualRevision: draft.revision,
          operation: 'prepareDraftDelivery',
          message: 'Draft was changed before delivery authorization.',
        })
      }

      const materialized =
        draft.status === 'approved'
          ? yield* materializeFirstDelivery(tx, draft, input)
          : yield* databaseEffect('prepareDelivery.loadRetryProvider', () =>
              tx
                .select({ provider: mailDeliveryAttempt.provider })
                .from(mailDeliveryAttempt)
                .where(eq(mailDeliveryAttempt.messageId, messageId))
                .orderBy(desc(mailDeliveryAttempt.attemptNumber))
                .limit(1),
            ).pipe(
              Effect.flatMap((attempts) => {
                const previous = attempts[0]
                return previous === undefined || draft.conversationId === null
                  ? Effect.fail(
                      new MailRepositoryInvariantError({
                        operation: 'prepareDelivery.loadRetryProvider',
                        message:
                          'Failed draft is missing its prior provider route.',
                      }),
                    )
                  : Effect.succeed({
                      messageId,
                      conversationId: ConversationId.make(draft.conversationId),
                      provider: previous.provider,
                    })
              }),
            )
      const delivery = yield* reserveAttempt(
        tx,
        input,
        draft,
        materialized.messageId,
        materialized.conversationId,
        materialized.provider,
      )
      return DeliveryPreparation.cases.Ready.make({ delivery })
    }),
  )
})
