import type { GardenDatabase } from '@garden/db'
import {
  mailAddress,
  mailAttachment,
  mailConversation,
  mailConversationAssignment,
  mailConversationMessage,
  mailConversationState,
  mailDomain,
  mailDraft,
  mailDraftAttachment,
  mailDraftRecipient,
  mailMailbox,
  mailMailboxAccess,
  mailMessage,
  mailMessageAttachment,
  mailMessageReplyTo,
  mailRecipient,
} from '@garden/db/schema'
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { MailboxId } from '@garden/core/mail'
import {
  AccessibleMailbox,
  AssignmentSnapshot,
  ConversationSummary,
  DraftSnapshot,
  MailRepositoryNotFoundError,
  RepositoryMessage,
  ResolvedLocalAddress,
  type GetConversationInput,
  type GetDraftInput,
  type ListConversationsInput,
  type ListMailboxesInput,
  type ResolveLocalAddressInput,
} from './contracts.ts'
import {
  actionActorValue,
  conversationStateValue,
  databaseEffect,
  decodeRow,
  mailActorValue,
  mailboxActorPredicate,
  messageAuthorValue,
  requireConversationAccess,
  requireMailboxAccess,
  stateActorPredicate,
  timestamp,
  type MailDatabase,
} from './shared.ts'

const activeDraftStatuses = [
  'editing',
  'awaiting_approval',
  'approved',
  'sending',
  'send_failed',
] as const

/** Produces a compact plain-text preview without exposing raw HTML in list rows. */
const messageSnippet = (textBody: string | null, htmlBody: string | null) =>
  (textBody ?? htmlBody?.replace(/<[^>]*>/g, ' ') ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)

/** Lists only active mailboxes granted to the requesting member or agent. */
export const listMailboxes = Effect.fn('MailRepository.listMailboxes')(
  function* (db: GardenDatabase, input: ListMailboxesInput) {
    const rows = yield* databaseEffect('listMailboxes', () =>
      db
        .select({
          mailbox: mailMailbox,
          accessLevel: mailMailboxAccess.accessLevel,
          localPart: mailAddress.localPart,
          domainName: mailDomain.name,
        })
        .from(mailMailboxAccess)
        .innerJoin(
          mailMailbox,
          and(
            eq(mailMailbox.id, mailMailboxAccess.mailboxId),
            eq(mailMailbox.workspaceId, mailMailboxAccess.workspaceId),
          ),
        )
        .leftJoin(
          mailAddress,
          and(
            eq(mailAddress.mailboxId, mailMailbox.id),
            eq(mailAddress.kind, 'primary'),
            eq(mailAddress.status, 'active'),
          ),
        )
        .leftJoin(mailDomain, eq(mailDomain.id, mailAddress.domainId))
        .where(
          and(
            eq(mailMailboxAccess.workspaceId, input.workspaceId),
            eq(mailMailbox.status, 'active'),
            mailboxActorPredicate(input.actor),
          ),
        )
        .orderBy(asc(mailMailbox.name)),
    )

    return yield* Effect.forEach(rows, (row) =>
      decodeRow(
        AccessibleMailbox,
        {
          id: row.mailbox.id,
          workspaceId: row.mailbox.workspaceId,
          name: row.mailbox.name,
          kind: row.mailbox.kind,
          accessLevel: row.accessLevel,
          primaryAddress:
            row.localPart === null || row.domainName === null
              ? null
              : `${row.localPart}@${row.domainName}`,
        },
        'listMailboxes.decode',
      ),
    )
  },
)

/** Lists actor-visible mailbox conversations with only that actor's state. */
export const listConversations = Effect.fn('MailRepository.listConversations')(
  function* (db: GardenDatabase, input: ListConversationsInput) {
    const actorStateJoin = and(
      eq(mailConversationState.conversationId, mailConversation.id),
      stateActorPredicate(input.actor),
    )
    const latestMessage = db
      .selectDistinctOn([mailConversationMessage.conversationId], {
        conversationId: mailConversationMessage.conversationId,
        id: mailMessage.id,
        source: mailMessage.source,
        authorType: mailMessage.authorType,
        authorMemberId: mailMessage.authorMemberId,
        authorAgentId: mailMessage.authorAgentId,
        senderName: mailMessage.senderName,
        senderAddress: mailMessage.senderAddress,
        textBody: mailMessage.textBody,
        htmlBody: mailMessage.htmlBody,
        authoredAt: mailMessage.authoredAt,
      })
      .from(mailConversationMessage)
      .innerJoin(
        mailMessage,
        and(
          eq(mailMessage.id, mailConversationMessage.messageId),
          eq(mailMessage.workspaceId, mailConversationMessage.workspaceId),
        ),
      )
      .orderBy(
        mailConversationMessage.conversationId,
        desc(mailMessage.authoredAt),
        desc(mailMessage.id),
      )
      .as('latest_conversation_message')
    const messageTotals = db
      .select({
        conversationId: mailConversationMessage.conversationId,
        count: sql<number>`count(*)::int`.as('message_count'),
      })
      .from(mailConversationMessage)
      .groupBy(mailConversationMessage.conversationId)
      .as('conversation_message_totals')
    const activeDrafts = db
      .select({
        conversationId: mailDraft.conversationId,
        count: sql<number>`count(*)::int`.as('active_draft_count'),
        latestUpdatedAt: sql<Date>`max(${mailDraft.updatedAt})`.as(
          'latest_draft_updated_at',
        ),
      })
      .from(mailDraft)
      .where(inArray(mailDraft.status, activeDraftStatuses))
      .groupBy(mailDraft.conversationId)
      .as('active_conversation_drafts')
    const rows = yield* databaseEffect('listConversations', () =>
      db
        .select({
          conversation: mailConversation,
          state: mailConversationState,
          latestMessageId: latestMessage.id,
          latestMessageSource: latestMessage.source,
          latestAuthorType: latestMessage.authorType,
          latestAuthorMemberId: latestMessage.authorMemberId,
          latestAuthorAgentId: latestMessage.authorAgentId,
          latestSenderName: latestMessage.senderName,
          latestSenderAddress: latestMessage.senderAddress,
          latestTextBody: latestMessage.textBody,
          latestHtmlBody: latestMessage.htmlBody,
          latestAuthoredAt: latestMessage.authoredAt,
          messageCount: messageTotals.count,
          activeDraftCount: activeDrafts.count,
          latestDraftUpdatedAt: activeDrafts.latestUpdatedAt,
        })
        .from(mailConversation)
        .innerJoin(
          mailMailboxAccess,
          and(
            eq(mailMailboxAccess.mailboxId, mailConversation.mailboxId),
            eq(mailMailboxAccess.workspaceId, mailConversation.workspaceId),
            mailboxActorPredicate(input.actor),
          ),
        )
        .innerJoin(
          mailMailbox,
          and(
            eq(mailMailbox.id, mailConversation.mailboxId),
            eq(mailMailbox.status, 'active'),
          ),
        )
        .leftJoin(mailConversationState, actorStateJoin)
        .leftJoin(
          latestMessage,
          eq(latestMessage.conversationId, mailConversation.id),
        )
        .leftJoin(
          messageTotals,
          eq(messageTotals.conversationId, mailConversation.id),
        )
        .leftJoin(
          activeDrafts,
          eq(activeDrafts.conversationId, mailConversation.id),
        )
        .where(
          and(
            eq(mailConversation.workspaceId, input.workspaceId),
            input.mailboxId === null
              ? undefined
              : eq(mailConversation.mailboxId, input.mailboxId),
          ),
        )
        .orderBy(desc(mailConversation.lastMessageAt)),
    )

    return yield* Effect.forEach(rows, (row) =>
      decodeRow(
        ConversationSummary,
        {
          id: row.conversation.id,
          mailboxId: row.conversation.mailboxId,
          subject: row.conversation.subject,
          lastMessageAt: timestamp(row.conversation.lastMessageAt),
          lastSenderName: row.latestSenderName,
          lastSenderAddress: row.latestSenderAddress,
          lastAuthor:
            row.latestMessageId === null
              ? null
              : messageAuthorValue({
                  authorType: row.latestAuthorType!,
                  authorMemberId: row.latestAuthorMemberId,
                  authorAgentId: row.latestAuthorAgentId,
                }),
          snippet: messageSnippet(row.latestTextBody, row.latestHtmlBody),
          messageCount: row.messageCount ?? 0,
          unread:
            row.latestMessageId !== null &&
            row.state?.lastReadMessageId !== row.latestMessageId,
          hasDraft: (row.activeDraftCount ?? 0) > 0,
          needsReply:
            row.latestMessageSource === 'inbound' &&
            (row.latestDraftUpdatedAt === null ||
              row.latestDraftUpdatedAt === undefined ||
              (row.latestAuthoredAt !== null &&
                row.latestDraftUpdatedAt <= row.latestAuthoredAt)),
          state: conversationStateValue(row.state),
        },
        'listConversations.decode',
      ),
    )
  },
)

/** Resolves exact addresses before a domain catch-all and rejects inactive routes. */
export const resolveLocalAddress = Effect.fn(
  'MailRepository.resolveLocalAddress',
)(function* (db: GardenDatabase, input: ResolveLocalAddressInput) {
  const envelopeAddress = input.address.trim().toLowerCase()
  const separator = envelopeAddress.lastIndexOf('@')
  if (separator <= 0 || separator === envelopeAddress.length - 1) {
    return yield* new MailRepositoryNotFoundError({
      entity: 'mailAddress',
      id: envelopeAddress,
      operation: 'resolveLocalAddress',
      message: 'No active Garden address matches this destination.',
    })
  }
  const localPart = envelopeAddress.slice(0, separator)
  const domainName = envelopeAddress.slice(separator + 1)
  const rows = yield* databaseEffect('resolveLocalAddress', () =>
    db
      .select({
        workspaceId: mailAddress.workspaceId,
        domainId: mailDomain.id,
        localAddressId: mailAddress.id,
        mailboxId: mailAddress.mailboxId,
        addressKind: mailAddress.kind,
        matchedLocalPart: mailAddress.localPart,
      })
      .from(mailAddress)
      .innerJoin(mailDomain, eq(mailDomain.id, mailAddress.domainId))
      .innerJoin(mailMailbox, eq(mailMailbox.id, mailAddress.mailboxId))
      .where(
        and(
          eq(mailDomain.name, domainName),
          eq(mailDomain.status, 'active'),
          eq(mailAddress.status, 'active'),
          eq(mailMailbox.status, 'active'),
          or(
            eq(mailAddress.localPart, localPart),
            eq(mailAddress.localPart, '*'),
          ),
        ),
      )
      .orderBy(
        sql`case when ${mailAddress.localPart} = ${localPart} then 0 else 1 end`,
      )
      .limit(1),
  )
  const row = rows[0]
  if (row === undefined) {
    return yield* new MailRepositoryNotFoundError({
      entity: 'mailAddress',
      id: envelopeAddress,
      operation: 'resolveLocalAddress',
      message: 'No active Garden address matches this destination.',
    })
  }
  return yield* decodeRow(
    ResolvedLocalAddress,
    {
      ...row,
      matchedBy: row.matchedLocalPart === localPart ? 'exact' : 'catch_all',
      envelopeAddress,
    },
    'resolveLocalAddress.decode',
  )
})

/** Loads mutable draft recipients and attachments as one collaboration snapshot. */
export const loadDraftSnapshot = Effect.fn('MailRepository.loadDraftSnapshot')(
  function* (db: MailDatabase, draft: typeof mailDraft.$inferSelect) {
    const [recipients, attachments] = yield* Effect.all([
      databaseEffect('loadDraft.recipients', () =>
        db
          .select()
          .from(mailDraftRecipient)
          .where(eq(mailDraftRecipient.draftId, draft.id))
          .orderBy(
            asc(mailDraftRecipient.kind),
            asc(mailDraftRecipient.position),
          ),
      ),
      databaseEffect('loadDraft.attachments', () =>
        db
          .select({ reference: mailDraftAttachment })
          .from(mailDraftAttachment)
          .where(eq(mailDraftAttachment.draftId, draft.id))
          .orderBy(asc(mailDraftAttachment.position)),
      ),
    ])
    return yield* decodeRow(
      DraftSnapshot,
      {
        id: draft.id,
        mailboxId: draft.mailboxId,
        fromAddressId: draft.fromAddressId,
        conversationId: draft.conversationId,
        author: mailActorValue({
          actorType: draft.authorType,
          memberId: draft.authorMemberId,
          agentId: draft.authorAgentId,
        }),
        replyToMessageId: draft.replyToMessageId,
        status: draft.status,
        revision: draft.revision,
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody: draft.htmlBody,
        recipients: recipients.map((recipient) => ({
          kind: recipient.kind,
          position: recipient.position,
          displayName: recipient.displayName,
          address: recipient.address,
        })),
        attachments: attachments.map(({ reference }) => ({
          attachmentId: reference.attachmentId,
          disposition: reference.disposition,
          contentId: reference.contentId,
          position: reference.position,
        })),
        updatedAt: timestamp(draft.updatedAt),
      },
      'loadDraft.decode',
    )
  },
)

/** Loads one draft only after actor access to its mailbox is verified. */
export const getDraft = Effect.fn('MailRepository.getDraft')(function* (
  db: GardenDatabase,
  input: GetDraftInput,
) {
  const rows = yield* databaseEffect('getDraft.find', () =>
    db
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
  const draft = rows[0]
  if (!draft) {
    return yield* new MailRepositoryNotFoundError({
      entity: 'draft',
      id: input.draftId,
      operation: 'getDraft',
      message: 'Draft does not exist.',
    })
  }
  yield* requireMailboxAccess(db, {
    workspaceId: input.workspaceId,
    mailboxId: MailboxId.make(draft.mailboxId),
    actor: input.actor,
    write: false,
    operation: 'getDraft.authorize',
  })
  return yield* loadDraftSnapshot(db, draft)
})

/** Loads one actor-scoped conversation without exposing private local deliveries. */
export const getConversation = Effect.fn('MailRepository.getConversation')(
  function* (db: GardenDatabase, input: GetConversationInput) {
    const conversation = yield* requireConversationAccess(db, {
      ...input,
      write: false,
      operation: 'getConversation',
    })
    const actorStateJoin = and(
      eq(mailConversationState.conversationId, conversation.id),
      stateActorPredicate(input.actor),
    )
    const [stateRows, messageRows, draftRows, assignmentRows] =
      yield* Effect.all([
        databaseEffect('getConversation.state', () =>
          db
            .select()
            .from(mailConversationState)
            .where(actorStateJoin)
            .limit(1),
        ),
        databaseEffect('getConversation.messages', () =>
          db
            .select({ message: mailMessage })
            .from(mailConversationMessage)
            .innerJoin(
              mailMessage,
              and(
                eq(mailMessage.id, mailConversationMessage.messageId),
                eq(
                  mailMessage.workspaceId,
                  mailConversationMessage.workspaceId,
                ),
              ),
            )
            .where(
              and(
                eq(mailConversationMessage.workspaceId, input.workspaceId),
                eq(
                  mailConversationMessage.conversationId,
                  input.conversationId,
                ),
              ),
            )
            .orderBy(asc(mailMessage.authoredAt)),
        ),
        databaseEffect('getConversation.drafts', () =>
          db
            .select()
            .from(mailDraft)
            .where(
              and(
                eq(mailDraft.workspaceId, input.workspaceId),
                eq(mailDraft.conversationId, input.conversationId),
              ),
            )
            .orderBy(desc(mailDraft.updatedAt)),
        ),
        databaseEffect('getConversation.assignments', () =>
          db
            .select()
            .from(mailConversationAssignment)
            .where(
              and(
                eq(mailConversationAssignment.workspaceId, input.workspaceId),
                eq(
                  mailConversationAssignment.conversationId,
                  input.conversationId,
                ),
                isNull(mailConversationAssignment.unassignedAt),
              ),
            )
            .orderBy(asc(mailConversationAssignment.assignedAt)),
        ),
      ])

    const messageIds = messageRows.map(({ message }) => message.id)
    const [recipientRows, replyToRows, attachmentRows] =
      messageIds.length === 0
        ? [[], [], []]
        : yield* Effect.all([
            databaseEffect('getConversation.recipients', () =>
              db
                .select()
                .from(mailRecipient)
                .where(inArray(mailRecipient.messageId, messageIds))
                .orderBy(asc(mailRecipient.kind), asc(mailRecipient.position)),
            ),
            databaseEffect('getConversation.replyTo', () =>
              db
                .select()
                .from(mailMessageReplyTo)
                .where(inArray(mailMessageReplyTo.messageId, messageIds))
                .orderBy(asc(mailMessageReplyTo.position)),
            ),
            databaseEffect('getConversation.attachments', () =>
              db
                .select({
                  reference: mailMessageAttachment,
                  attachment: mailAttachment,
                })
                .from(mailMessageAttachment)
                .innerJoin(
                  mailAttachment,
                  eq(mailAttachment.id, mailMessageAttachment.attachmentId),
                )
                .where(inArray(mailMessageAttachment.messageId, messageIds))
                .orderBy(asc(mailMessageAttachment.position)),
            ),
          ])

    /** Grouping by canonical message keeps local-delivery routing absent by construction. */
    const recipientsByMessage = new Map<
      string,
      Array<typeof mailRecipient.$inferSelect>
    >()
    for (const recipient of recipientRows) {
      const current = recipientsByMessage.get(recipient.messageId) ?? []
      current.push(recipient)
      recipientsByMessage.set(recipient.messageId, current)
    }
    const replyToByMessage = new Map<
      string,
      Array<typeof mailMessageReplyTo.$inferSelect>
    >()
    for (const replyTo of replyToRows) {
      const current = replyToByMessage.get(replyTo.messageId) ?? []
      current.push(replyTo)
      replyToByMessage.set(replyTo.messageId, current)
    }
    const attachmentsByMessage = new Map<
      string,
      Array<(typeof attachmentRows)[number]>
    >()
    for (const attachment of attachmentRows) {
      const current =
        attachmentsByMessage.get(attachment.reference.messageId) ?? []
      current.push(attachment)
      attachmentsByMessage.set(attachment.reference.messageId, current)
    }

    const messages = yield* Effect.forEach(messageRows, ({ message }) =>
      decodeRow(
        RepositoryMessage,
        {
          id: message.id,
          source: message.source,
          author: messageAuthorValue(message),
          senderName: message.senderName,
          senderAddress: message.senderAddress,
          subject: message.subject,
          textBody: message.textBody,
          htmlBody: message.htmlBody,
          internetMessageId: message.internetMessageId,
          inReplyToMessageId: message.inReplyToMessageId,
          referenceMessageIds: message.referenceMessageIds,
          authoredAt: timestamp(message.authoredAt),
          replyTo: (replyToByMessage.get(message.id) ?? []).map((replyTo) => ({
            position: replyTo.position,
            displayName: replyTo.displayName,
            address: replyTo.address,
          })),
          recipients: (recipientsByMessage.get(message.id) ?? []).map(
            (recipient) => ({
              kind: recipient.kind,
              position: recipient.position,
              displayName: recipient.displayName,
              address: recipient.address,
            }),
          ),
          attachments: (attachmentsByMessage.get(message.id) ?? []).map(
            ({ reference, attachment }) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              contentType: attachment.contentType,
              sizeBytes: attachment.sizeBytes,
              disposition: reference.disposition,
              contentId: reference.contentId,
              position: reference.position,
            }),
          ),
        },
        'getConversation.message.decode',
      ),
    )
    const drafts = yield* Effect.forEach(draftRows, (draft) =>
      loadDraftSnapshot(db, draft),
    )
    const assignments = yield* Effect.forEach(assignmentRows, (assignment) =>
      decodeRow(
        AssignmentSnapshot,
        {
          id: assignment.id,
          conversationId: assignment.conversationId,
          assignee: mailActorValue({
            actorType: assignment.assigneeType,
            memberId: assignment.assigneeMemberId,
            agentId: assignment.assigneeAgentId,
          }),
          assignedBy: actionActorValue({
            actorType: assignment.assignedByType,
            memberId: assignment.assignedByMemberId,
            agentId: assignment.assignedByAgentId,
          }),
          assignedAt: timestamp(assignment.assignedAt),
          unassignedAt: timestamp(assignment.unassignedAt),
        },
        'getConversation.assignment.decode',
      ),
    )
    const summary = yield* decodeRow(
      ConversationSummary,
      {
        id: conversation.id,
        mailboxId: conversation.mailboxId,
        subject: conversation.subject,
        lastMessageAt: timestamp(conversation.lastMessageAt),
        lastSenderName: messages.at(-1)?.senderName ?? null,
        lastSenderAddress: messages.at(-1)?.senderAddress ?? null,
        lastAuthor: messages.at(-1)?.author ?? null,
        snippet: messageSnippet(
          messages.at(-1)?.textBody ?? null,
          messages.at(-1)?.htmlBody ?? null,
        ),
        messageCount: messages.length,
        unread:
          messages.length > 0 &&
          stateRows[0]?.lastReadMessageId !== messages.at(-1)?.id,
        hasDraft: draftRows.some((draft) =>
          activeDraftStatuses.includes(
            draft.status as (typeof activeDraftStatuses)[number],
          ),
        ),
        needsReply:
          messageRows.at(-1)?.message.source === 'inbound' &&
          !draftRows.some(
            (draft) =>
              activeDraftStatuses.includes(
                draft.status as (typeof activeDraftStatuses)[number],
              ) && draft.updatedAt > messageRows.at(-1)!.message.authoredAt,
          ),
        state: conversationStateValue(stateRows[0] ?? null),
      },
      'getConversation.summary.decode',
    )
    return { conversation: summary, messages, drafts, assignments }
  },
)
