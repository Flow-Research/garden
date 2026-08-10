import type { GardenDatabase } from '@garden/db'
import {
  mailAddress,
  mailAttachment,
  mailConversation,
  mailConversationMessage,
  mailDomain,
  mailMailbox,
  mailMessage,
  mailMessageAttachment,
  mailMessageLocalDelivery,
  mailMessageReplyTo,
  mailRecipient,
} from '@garden/db/schema'
import {
  IngestedMail,
  type InboundMailEnvelope,
  type MessageAuthor,
} from '@garden/core/mail'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { MailRepositoryInvariantError } from './contracts.ts'
import {
  databaseEffect,
  decodeRow,
  inTransaction,
  type MailTransaction,
} from './shared.ts'

/** Maps canonical authorship into immutable message discriminator columns. */
const storedMessageAuthor = (author: MessageAuthor) => {
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

/** Normalizes common reply/forward prefixes for mailbox-local thread display. */
const normalizedSubject = (subject: string): string =>
  subject
    .replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()

/** Chooses a stable provider-neutral thread seed when no prior projection exists. */
const inboundThreadKey = (input: InboundMailEnvelope): string =>
  input.referenceMessageIds[0] ??
  input.inReplyToMessageId ??
  input.internetMessageId ??
  `${input.provider}:${input.providerMessageId}`

/** Finds an existing projected thread by RFC references before using the seed key. */
const findOrCreateConversation = Effect.fn(
  'MailRepository.findOrCreateConversation',
)(function* (
  tx: MailTransaction,
  input: InboundMailEnvelope,
  mailboxId: string,
  messageId: string,
) {
  const referencedIds = [
    ...input.referenceMessageIds,
    ...(input.inReplyToMessageId === null ? [] : [input.inReplyToMessageId]),
  ]
  const referencedConversation =
    referencedIds.length === 0
      ? undefined
      : (yield* databaseEffect('ingestInbound.findReferencedThread', () =>
          tx
            .select({ conversation: mailConversation })
            .from(mailConversation)
            .innerJoin(
              mailConversationMessage,
              eq(mailConversationMessage.conversationId, mailConversation.id),
            )
            .innerJoin(
              mailMessage,
              eq(mailMessage.id, mailConversationMessage.messageId),
            )
            .where(
              and(
                eq(mailConversation.workspaceId, input.workspaceId),
                eq(mailConversation.mailboxId, mailboxId),
                inArray(mailMessage.internetMessageId, referencedIds),
              ),
            )
            .orderBy(desc(mailMessage.authoredAt))
            .limit(1),
        ))[0]?.conversation

  let conversation = referencedConversation
  if (conversation === undefined) {
    const threadKey = inboundThreadKey(input)
    const inserted = yield* databaseEffect(
      'ingestInbound.createConversation',
      () =>
        tx
          .insert(mailConversation)
          .values({
            workspaceId: input.workspaceId,
            mailboxId,
            threadKey,
            subject: input.subject,
            normalizedSubject: normalizedSubject(input.subject),
            lastMessageAt: new Date(input.authoredAt),
          })
          .onConflictDoNothing()
          .returning(),
    )
    conversation = inserted[0]
    if (conversation === undefined) {
      const existing = yield* databaseEffect(
        'ingestInbound.findSeededConversation',
        () =>
          tx
            .select()
            .from(mailConversation)
            .where(
              and(
                eq(mailConversation.workspaceId, input.workspaceId),
                eq(mailConversation.mailboxId, mailboxId),
                eq(mailConversation.threadKey, threadKey),
              ),
            )
            .limit(1),
      )
      conversation = existing[0]
    }
  }
  if (conversation === undefined) {
    return yield* new MailRepositoryInvariantError({
      operation: 'ingestInbound.findOrCreateConversation',
      message: 'Conversation could not be resolved after idempotent insert.',
    })
  }

  yield* databaseEffect('ingestInbound.projectMessage', () =>
    tx
      .insert(mailConversationMessage)
      .values({
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        messageId,
      })
      .onConflictDoNothing(),
  )
  yield* databaseEffect('ingestInbound.updateConversationActivity', () =>
    tx
      .update(mailConversation)
      .set({
        lastMessageAt: sql`greatest(coalesce(${mailConversation.lastMessageAt}, ${new Date(input.authoredAt)}), ${new Date(input.authoredAt)})`,
        updatedAt: new Date(),
      })
      .where(eq(mailConversation.id, conversation.id)),
  )
  return conversation.id
})

/** Inserts immutable attachment metadata or verifies the existing storage identity. */
const attachInboundContent = Effect.fn('MailRepository.attachInboundContent')(
  function* (
    tx: MailTransaction,
    input: InboundMailEnvelope,
    messageId: string,
  ) {
    yield* Effect.forEach(input.attachments, (attachment) =>
      Effect.gen(function* () {
        const inserted = yield* databaseEffect(
          'ingestInbound.insertAttachment',
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
          (yield* databaseEffect('ingestInbound.findAttachment', () =>
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
            operation: 'ingestInbound.attachContent',
            message:
              'Attachment storage key conflicts with different immutable content.',
          })
        }
        yield* databaseEffect('ingestInbound.linkAttachment', () =>
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
 * Idempotently creates immutable content, then always merges newly observed
 * local deliveries and mailbox projections for a duplicate provider event.
 */
export const ingestInbound = Effect.fn('MailRepository.ingestInbound')(
  function* (db: GardenDatabase, input: InboundMailEnvelope) {
    return yield* inTransaction(db, 'ingestInbound', (tx) =>
      Effect.gen(function* () {
        const author = storedMessageAuthor(input.author)
        const inserted = yield* databaseEffect(
          'ingestInbound.insertMessage',
          () =>
            tx
              .insert(mailMessage)
              .values({
                workspaceId: input.workspaceId,
                source: 'inbound',
                ...author,
                senderName: input.senderName,
                senderAddress: input.senderAddress,
                subject: input.subject,
                textBody: input.textBody,
                htmlBody: input.htmlBody,
                internetMessageId: input.internetMessageId,
                inReplyToMessageId: input.inReplyToMessageId,
                referenceMessageIds: [...input.referenceMessageIds],
                replyToMessageId: null,
                ingressProvider: input.provider,
                ingressProviderMessageId: input.providerMessageId,
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
          (yield* databaseEffect('ingestInbound.findMessage', () =>
            tx
              .select()
              .from(mailMessage)
              .where(
                and(
                  eq(mailMessage.workspaceId, input.workspaceId),
                  eq(mailMessage.ingressProvider, input.provider),
                  eq(
                    mailMessage.ingressProviderMessageId,
                    input.providerMessageId,
                  ),
                ),
              )
              .limit(1),
          ))[0]
        if (message === undefined) {
          return yield* new MailRepositoryInvariantError({
            operation: 'ingestInbound.resolveMessage',
            message: 'Canonical message was not found after idempotent insert.',
          })
        }

        if (!duplicate) {
          if (input.recipients.length > 0) {
            yield* databaseEffect('ingestInbound.insertRecipients', () =>
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
            yield* databaseEffect('ingestInbound.insertReplyTo', () =>
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
          yield* attachInboundContent(tx, input, message.id)
        }

        const localAddressIds = [
          ...new Set(
            input.localRecipients.map((recipient) => recipient.localAddressId),
          ),
        ]
        const routes = yield* databaseEffect(
          'ingestInbound.resolveRoutes',
          () =>
            tx
              .select({
                localAddressId: mailAddress.id,
                mailboxId: mailAddress.mailboxId,
                localPart: mailAddress.localPart,
                domainName: mailDomain.name,
              })
              .from(mailAddress)
              .innerJoin(mailDomain, eq(mailDomain.id, mailAddress.domainId))
              .innerJoin(mailMailbox, eq(mailMailbox.id, mailAddress.mailboxId))
              .where(
                and(
                  eq(mailAddress.workspaceId, input.workspaceId),
                  inArray(mailAddress.id, localAddressIds),
                  eq(mailAddress.status, 'active'),
                  eq(mailDomain.status, 'active'),
                  eq(mailMailbox.status, 'active'),
                ),
              ),
        )
        const routeByAddressId = new Map(
          routes.map((route) => [route.localAddressId, route]),
        )
        yield* Effect.forEach(input.localRecipients, (recipient) =>
          Effect.gen(function* () {
            const route = routeByAddressId.get(recipient.localAddressId)
            const [envelopeLocalPart, envelopeDomain] =
              recipient.envelopeAddress.toLowerCase().split('@')
            if (
              route === undefined ||
              envelopeLocalPart === undefined ||
              envelopeDomain === undefined ||
              envelopeDomain !== route.domainName ||
              (route.localPart !== '*' && route.localPart !== envelopeLocalPart)
            ) {
              return yield* new MailRepositoryInvariantError({
                operation: 'ingestInbound.resolveRoutes',
                message:
                  'Inbound local recipient is not an active workspace route.',
              })
            }
            yield* databaseEffect('ingestInbound.insertLocalDelivery', () =>
              tx
                .insert(mailMessageLocalDelivery)
                .values({
                  workspaceId: input.workspaceId,
                  messageId: message.id,
                  localAddressId: recipient.localAddressId,
                  envelopeAddress: recipient.envelopeAddress,
                  providerRecipientId: recipient.providerRecipientId,
                  providerEvidence: recipient.providerEvidence,
                  receivedAt: new Date(input.receivedAt),
                })
                .onConflictDoNothing(),
            )
            yield* findOrCreateConversation(
              tx,
              input,
              route.mailboxId,
              message.id,
            )
          }),
        )

        const projections = yield* databaseEffect(
          'ingestInbound.listProjections',
          () =>
            tx
              .select({
                conversationId: mailConversationMessage.conversationId,
              })
              .from(mailConversationMessage)
              .where(eq(mailConversationMessage.messageId, message.id))
              .orderBy(asc(mailConversationMessage.conversationId)),
        )

        return yield* decodeRow(
          IngestedMail,
          {
            messageId: message.id,
            conversationIds: projections.map(
              (projection) => projection.conversationId,
            ),
            duplicate,
          },
          'ingestInbound.decode',
        )
      }),
    )
  },
)
