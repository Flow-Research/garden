import type { GardenDatabase } from '@garden/db'
import {
  mailAttachment,
  mailConversation,
  mailConversationMessage,
  mailConversationState,
  mailMailbox,
  mailMessage,
  mailMessageAttachment,
  mailMessageReplyTo,
  mailRecipient,
  mailSyncAccount,
  member,
} from '@garden/db/schema'
import {
  IngestedMail,
  type ImportedMailEnvelope,
  type MessageAuthor,
} from '@garden/core/mail'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { MailRepositoryInvariantError } from './contracts.ts'
import {
  databaseEffect,
  decodeRow,
  inTransaction,
  type MailTransaction,
} from './shared.ts'

/** Maps shared authorship into the canonical message discriminator columns. */
const storedImportedAuthor = (author: MessageAuthor) => {
  if (author._tag === 'Member') {
    return {
      authorType: 'member' as const,
      authorMemberId: author.memberId,
      authorAgentId: null,
    }
  }
  if (author._tag === 'Agent') {
    return {
      authorType: 'agent' as const,
      authorMemberId: null,
      authorAgentId: author.agentId,
    }
  }
  return {
    authorType:
      author._tag === 'System' ? ('system' as const) : ('external' as const),
    authorMemberId: null,
    authorAgentId: null,
  }
}

/** Normalizes reply/forward prefixes only for mailbox list grouping and display. */
const normalizedImportedSubject = (subject: string): string =>
  subject
    .replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()

/** Reads Gmail system labels from evidence produced by the decoded client. */
const providerLabelIds = (
  evidence: Readonly<Record<string, unknown>> | null,
): ReadonlySet<string> => {
  const value = evidence?.labelIds
  return new Set(
    Array.isArray(value)
      ? value.filter((label): label is string => typeof label === 'string')
      : [],
  )
}

/**
 * Reconciles Gmail's per-message labels into the connected account owner's
 * conversation state. Evidence remains the durable per-message source so a
 * later label-only history event can update read, archive, and star without
 * duplicating canonical message content.
 */
const reconcileImportedConversationState = Effect.fn(
  'MailRepository.reconcileImportedConversationState',
)(function* (
  tx: MailTransaction,
  input: ImportedMailEnvelope,
  conversationId: string,
) {
  if (input.provider !== 'gmail') return
  const owner = (yield* databaseEffect(
    'ingestImported.resolveOwnerMember',
    () =>
      tx
        .select({ memberId: member.id })
        .from(mailSyncAccount)
        .innerJoin(
          member,
          and(
            eq(member.userId, mailSyncAccount.userId),
            eq(member.organizationId, mailSyncAccount.workspaceId),
          ),
        )
        .where(
          and(
            eq(mailSyncAccount.id, input.syncAccountId),
            eq(mailSyncAccount.workspaceId, input.workspaceId),
          ),
        )
        .limit(1),
  ))[0]
  if (owner === undefined) {
    return yield* new MailRepositoryInvariantError({
      operation: 'ingestImported.resolveOwnerMember',
      message: 'Imported Gmail account owner is not a workspace member.',
    })
  }
  const messages = yield* databaseEffect(
    'ingestImported.listConversationProviderState',
    () =>
      tx
        .select({
          id: mailMessage.id,
          evidence: mailMessage.ingressProviderEvidence,
        })
        .from(mailConversationMessage)
        .innerJoin(
          mailMessage,
          and(
            eq(mailMessage.id, mailConversationMessage.messageId),
            eq(mailMessage.workspaceId, mailConversationMessage.workspaceId),
          ),
        )
        .where(
          and(
            eq(mailConversationMessage.conversationId, conversationId),
            eq(mailMessage.ingressProvider, 'gmail'),
            sql`${mailMessage.ingressProviderMessageId} like ${`${input.syncAccountId}:%`}`,
          ),
        )
        .orderBy(desc(mailMessage.authoredAt), desc(mailMessage.createdAt)),
  )
  const labels = messages.map((item) => providerLabelIds(item.evidence ?? null))
  const read = labels.every((item) => !item.has('UNREAD'))
  const archived = labels.every((item) => !item.has('INBOX'))
  const starred = labels.some((item) => item.has('STARRED'))
  const current = (yield* databaseEffect(
    'ingestImported.findOwnerConversationState',
    () =>
      tx
        .select()
        .from(mailConversationState)
        .where(
          and(
            eq(mailConversationState.conversationId, conversationId),
            eq(mailConversationState.memberId, owner.memberId),
          ),
        )
        .limit(1),
  ))[0]
  const now = new Date()
  const values = {
    workspaceId: input.workspaceId,
    conversationId,
    actorType: 'member' as const,
    memberId: owner.memberId,
    agentId: null,
    lastReadMessageId: read ? (messages[0]?.id ?? null) : null,
    readAt: read ? now : null,
    archivedAt: archived ? now : null,
    mutedAt: current?.mutedAt ?? null,
    pinned: starred,
    updatedAt: now,
  }
  if (current === undefined) {
    yield* databaseEffect('ingestImported.insertOwnerConversationState', () =>
      tx.insert(mailConversationState).values(values),
    )
  } else {
    yield* databaseEffect('ingestImported.updateOwnerConversationState', () =>
      tx
        .update(mailConversationState)
        .set(values)
        .where(eq(mailConversationState.id, current.id)),
    )
  }
})

/**
 * Stores imported attachment metadata by immutable storage key. A conflicting
 * hash means the caller reused an object key and must fail the whole message.
 */
const attachImportedContent = Effect.fn('MailRepository.attachImportedContent')(
  function* (
    tx: MailTransaction,
    input: ImportedMailEnvelope,
    messageId: string,
  ) {
    yield* Effect.forEach(input.attachments, (attachment) =>
      Effect.gen(function* () {
        const inserted = yield* databaseEffect(
          'ingestImported.insertAttachment',
          () =>
            tx
              .insert(mailAttachment)
              .values({
                workspaceId: input.workspaceId,
                storageKey: attachment.storageKey,
                fileName: attachment.fileName,
                contentType: attachment.contentType,
                sizeBytes: attachment.sizeBytes,
                contentHash: attachment.contentHash,
              })
              .onConflictDoNothing()
              .returning(),
        )
        const stored =
          inserted[0] ??
          (yield* databaseEffect('ingestImported.findAttachment', () =>
            tx
              .select()
              .from(mailAttachment)
              .where(
                and(
                  eq(mailAttachment.workspaceId, input.workspaceId),
                  eq(mailAttachment.storageKey, attachment.storageKey),
                ),
              )
              .limit(1),
          ))[0]
        if (
          stored === undefined ||
          stored.contentHash !== attachment.contentHash ||
          stored.sizeBytes !== attachment.sizeBytes ||
          stored.contentType !== attachment.contentType
        ) {
          return yield* new MailRepositoryInvariantError({
            operation: 'ingestImported.attachContent',
            message:
              'Attachment storage key conflicts with different immutable content.',
          })
        }
        yield* databaseEffect('ingestImported.linkAttachment', () =>
          tx
            .insert(mailMessageAttachment)
            .values({
              workspaceId: input.workspaceId,
              messageId,
              attachmentId: stored.id,
              disposition: attachment.disposition,
              contentId: attachment.contentId,
              position: attachment.position,
            })
            .onConflictDoNothing(),
        )
      }),
    )
  },
)

/**
 * Idempotently imports one provider message into its account-owned mailbox.
 * Gmail IDs are namespaced by account so the same provider object can never
 * collide across separate personal connections or leak into hosted routing.
 */
export const ingestImported = Effect.fn('MailRepository.ingestImported')(
  function* (db: GardenDatabase, input: ImportedMailEnvelope) {
    return yield* inTransaction(db, 'ingestImported', (tx) =>
      Effect.gen(function* () {
        const account = (yield* databaseEffect(
          'ingestImported.resolveAccount',
          () =>
            tx
              .select({ account: mailSyncAccount, mailbox: mailMailbox })
              .from(mailSyncAccount)
              .innerJoin(
                mailMailbox,
                and(
                  eq(mailMailbox.id, mailSyncAccount.mailboxId),
                  eq(mailMailbox.workspaceId, mailSyncAccount.workspaceId),
                ),
              )
              .where(
                and(
                  eq(mailSyncAccount.id, input.syncAccountId),
                  eq(mailSyncAccount.workspaceId, input.workspaceId),
                ),
              )
              .limit(1),
        ))[0]
        if (
          account === undefined ||
          account.account.provider !== input.provider ||
          account.account.status === 'disconnected' ||
          account.mailbox.origin !== 'external_import' ||
          account.mailbox.status !== 'active'
        ) {
          return yield* new MailRepositoryInvariantError({
            operation: 'ingestImported.resolveAccount',
            message:
              'Import account is not an active external mailbox for this provider.',
          })
        }

        const ingressProviderMessageId = `${input.syncAccountId}:${input.providerMessageId}`
        const author = storedImportedAuthor(input.author)
        const inserted = yield* databaseEffect(
          'ingestImported.insertMessage',
          () =>
            tx
              .insert(mailMessage)
              .values({
                workspaceId: input.workspaceId,
                source: 'imported',
                ...author,
                senderName: input.senderName,
                senderAddressId: null,
                senderAddress: input.senderAddress,
                subject: input.subject,
                textBody: input.textBody,
                htmlBody: input.htmlBody,
                internetMessageId: input.internetMessageId,
                inReplyToMessageId: input.inReplyToMessageId,
                referenceMessageIds: [...input.referenceMessageIds],
                replyToMessageId: null,
                ingressProvider: input.provider,
                ingressProviderMessageId,
                ingressProviderEvidence: input.providerEvidence,
                rawStorageKey: input.rawStorageKey,
                authoredAt: new Date(input.authoredAt),
              })
              .onConflictDoNothing()
              .returning(),
        )
        const duplicate = inserted.length === 0
        const message =
          inserted[0] ??
          (yield* databaseEffect('ingestImported.findMessage', () =>
            tx
              .select()
              .from(mailMessage)
              .where(
                and(
                  eq(mailMessage.workspaceId, input.workspaceId),
                  eq(mailMessage.ingressProvider, input.provider),
                  eq(
                    mailMessage.ingressProviderMessageId,
                    ingressProviderMessageId,
                  ),
                ),
              )
              .limit(1),
          ))[0]
        if (message === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'ingestImported.resolveMessage',
            message: 'Canonical message was not found after idempotent insert.',
          })
        }

        yield* databaseEffect('ingestImported.refreshProviderEvidence', () =>
          tx
            .update(mailMessage)
            .set({ ingressProviderEvidence: input.providerEvidence })
            .where(eq(mailMessage.id, message.id)),
        )

        if (!duplicate) {
          if (input.recipients.length > 0) {
            yield* databaseEffect('ingestImported.insertRecipients', () =>
              tx.insert(mailRecipient).values(
                input.recipients.map((recipient) => ({
                  workspaceId: input.workspaceId,
                  messageId: message.id,
                  kind: recipient.kind,
                  position: recipient.position,
                  displayName: recipient.displayName,
                  address: recipient.address,
                })),
              ),
            )
          }
          if (input.replyTo.length > 0) {
            yield* databaseEffect('ingestImported.insertReplyTo', () =>
              tx.insert(mailMessageReplyTo).values(
                input.replyTo.map((replyTo) => ({
                  workspaceId: input.workspaceId,
                  messageId: message.id,
                  position: replyTo.position,
                  displayName: replyTo.displayName,
                  address: replyTo.address,
                })),
              ),
            )
          }
          yield* attachImportedContent(tx, input, message.id)
        }

        const threadKey = `${input.provider}:${input.syncAccountId}:${input.providerThreadId}`
        const createdConversation = yield* databaseEffect(
          'ingestImported.createConversation',
          () =>
            tx
              .insert(mailConversation)
              .values({
                workspaceId: input.workspaceId,
                mailboxId: account.mailbox.id,
                threadKey,
                subject: input.subject,
                normalizedSubject: normalizedImportedSubject(input.subject),
                lastMessageAt: new Date(input.authoredAt),
              })
              .onConflictDoNothing()
              .returning(),
        )
        const conversation =
          createdConversation[0] ??
          (yield* databaseEffect('ingestImported.findConversation', () =>
            tx
              .select()
              .from(mailConversation)
              .where(
                and(
                  eq(mailConversation.workspaceId, input.workspaceId),
                  eq(mailConversation.mailboxId, account.mailbox.id),
                  eq(mailConversation.threadKey, threadKey),
                ),
              )
              .limit(1),
          ))[0]
        if (conversation === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'ingestImported.resolveConversation',
            message: 'Imported conversation could not be resolved.',
          })
        }
        yield* databaseEffect('ingestImported.projectMessage', () =>
          tx
            .insert(mailConversationMessage)
            .values({
              workspaceId: input.workspaceId,
              conversationId: conversation.id,
              messageId: message.id,
            })
            .onConflictDoNothing(),
        )
        yield* databaseEffect('ingestImported.updateConversationActivity', () =>
          tx
            .update(mailConversation)
            .set({
              lastMessageAt: sql`greatest(coalesce(${mailConversation.lastMessageAt}, ${new Date(input.authoredAt)}), ${new Date(input.authoredAt)})`,
              updatedAt: new Date(),
            })
            .where(eq(mailConversation.id, conversation.id)),
        )
        yield* reconcileImportedConversationState(tx, input, conversation.id)

        return yield* decodeRow(
          IngestedMail,
          {
            messageId: message.id,
            conversationIds: [conversation.id],
            duplicate,
          },
          'ingestImported.decode',
        )
      }),
    )
  },
)
