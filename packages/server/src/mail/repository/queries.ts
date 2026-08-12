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
  mailSyncAccount,
} from '@garden/db/schema'
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { MailboxId } from '@garden/core/mail'
import {
  AccessibleMailbox,
  AssignmentSnapshot,
  ConversationPage,
  ConversationSummary,
  DraftSnapshot,
  MailRepositoryNotFoundError,
  RepositoryMessage,
  ResolvedLocalAddress,
  type GetConversationInput,
  type GetDraftInput,
  type ListConversationPageInput,
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
import { mailMessageSnippet } from './snippet.ts'

const activeDraftStatuses = [
  'editing',
  'awaiting_approval',
  'approved',
  'sending',
  'send_failed',
] as const

/** Lists only active mailboxes granted to the requesting member or agent. */
export const listMailboxes = Effect.fn('MailRepository.listMailboxes')(
  function* (db: GardenDatabase, input: ListMailboxesInput) {
    const rows = yield* databaseEffect('listMailboxes', () =>
      db
        .select({
          mailbox: mailMailbox,
          accessLevel: mailMailboxAccess.accessLevel,
          externalAddress: mailSyncAccount.providerEmail,
          externalAccountStatus: mailSyncAccount.status,
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
        .leftJoin(
          mailSyncAccount,
          eq(mailSyncAccount.mailboxId, mailMailbox.id),
        )
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
          origin: row.mailbox.origin,
          primaryAddress:
            row.localPart === null || row.domainName === null
              ? null
              : `${row.localPart}@${row.domainName}`,
          externalAddress: row.externalAddress,
          sendCapability:
            row.mailbox.origin === 'garden_hosted' &&
            row.localPart !== null &&
            row.domainName !== null
              ? 'garden_transport'
              : row.mailbox.origin === 'external_import' &&
                  row.externalAddress !== null &&
                  row.externalAccountStatus !== 'disconnected'
                ? 'gmail_transport'
                : 'read_only',
        },
        'listMailboxes.decode',
      ),
    )
  },
)

type ConversationQueryInput = ListConversationsInput & {
  readonly activeOnly: boolean
  readonly cursor: ListConversationPageInput['cursor']
  readonly query: string
  readonly unreadOnly: boolean
  readonly limit: number | null
}

/**
 * Owns the shared authorization, search, state filtering, and keyset ordering.
 * The prior unbounded query and the new page query therefore cannot drift in
 * actor visibility or summary semantics.
 */
const conversationRows = (
  db: GardenDatabase,
  input: ConversationQueryInput,
) => {
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
  const activityAt = sql<string>`coalesce(${mailConversation.lastMessageAt}, ${mailConversation.createdAt})`
  const normalizedQuery = input.query.trim()
  const search =
    normalizedQuery.length === 0
      ? undefined
      : sql`(
          to_tsvector('simple', coalesce(${mailConversation.subject}, ''))
            @@ websearch_to_tsquery('simple', ${normalizedQuery})
          or exists (
            select 1
            from mail_conversation_message search_link
            inner join mail_message search_message
              on search_message.id = search_link.message_id
              and search_message.workspace_id = search_link.workspace_id
            where search_link.conversation_id = ${mailConversation.id}
              and search_link.workspace_id = ${mailConversation.workspaceId}
              and (
                to_tsvector(
                  'simple',
                  coalesce(search_message.subject, '') || ' ' ||
                  coalesce(search_message.sender_name, '') || ' ' ||
                  coalesce(search_message.sender_address, '') || ' ' ||
                  coalesce(search_message.text_body, '')
                ) @@ websearch_to_tsquery('simple', ${normalizedQuery})
                or exists (
                  select 1
                  from mail_recipient search_recipient
                  where search_recipient.message_id = search_message.id
                    and search_recipient.workspace_id = search_message.workspace_id
                    and to_tsvector(
                      'simple',
                      coalesce(search_recipient.display_name, '') || ' ' ||
                      coalesce(search_recipient.address, '')
                    ) @@ websearch_to_tsquery('simple', ${normalizedQuery})
                )
              )
          )
        )`
  const cursorAt =
    input.cursor === null ? null : new Date(input.cursor.activityAt)
  const query = db
    .select({
      conversation: mailConversation,
      state: mailConversationState,
      activityAt,
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
        input.activeOnly ? isNull(mailConversationState.archivedAt) : undefined,
        input.unreadOnly
          ? sql`${latestMessage.id} is not null and ${mailConversationState.lastReadMessageId} is distinct from ${latestMessage.id}`
          : undefined,
        search,
        cursorAt === null || input.cursor === null
          ? undefined
          : or(
              lt(activityAt, cursorAt),
              and(
                eq(activityAt, cursorAt),
                lt(mailConversation.id, input.cursor.conversationId),
              ),
            ),
      ),
    )
    .orderBy(desc(activityAt), desc(mailConversation.id))
    .$dynamic()

  return input.limit === null ? query : query.limit(input.limit)
}

type ConversationRow = Awaited<ReturnType<typeof conversationRows>>[number]

/** Restores one joined projection through the canonical summary schema. */
const decodeConversationRow = (row: ConversationRow, operation: string) =>
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
      snippet: mailMessageSnippet(row.latestTextBody, row.latestHtmlBody),
      messageCount: row.messageCount ?? 0,
      unread:
        row.latestMessageId !== null &&
        row.state?.lastReadMessageId !== row.latestMessageId,
      hasDraft: (row.activeDraftCount ?? 0) > 0,
      needsReply:
        row.latestAuthorType === 'external' &&
        row.latestMessageId !== null &&
        row.state?.lastReadMessageId === row.latestMessageId &&
        (row.latestDraftUpdatedAt === null ||
          row.latestDraftUpdatedAt === undefined ||
          (row.latestAuthoredAt !== null &&
            row.latestDraftUpdatedAt <= row.latestAuthoredAt)),
      state: conversationStateValue(row.state),
    },
    operation,
  )

/** Lists actor-visible mailbox conversations with only that actor's state. */
export const listConversations = Effect.fn('MailRepository.listConversations')(
  function* (db: GardenDatabase, input: ListConversationsInput) {
    const rows = yield* databaseEffect('listConversations', () =>
      conversationRows(db, {
        ...input,
        activeOnly: false,
        cursor: null,
        query: '',
        unreadOnly: false,
        limit: null,
      }),
    )
    return yield* Effect.forEach(rows, (row) =>
      decodeConversationRow(row, 'listConversations.decode'),
    )
  },
)

/** Returns one stable, actor-authorized inbox page and its next keyset cursor. */
export const listConversationPage = Effect.fn(
  'MailRepository.listConversationPage',
)(function* (db: GardenDatabase, input: ListConversationPageInput) {
  const rows = yield* databaseEffect('listConversationPage', () =>
    conversationRows(db, {
      ...input,
      activeOnly: true,
      limit: input.limit + 1,
    }),
  )
  const hasNextPage = rows.length > input.limit
  const pageRows = hasNextPage ? rows.slice(0, input.limit) : rows
  const items = yield* Effect.forEach(pageRows, (row) =>
    decodeConversationRow(row, 'listConversationPage.decodeSummary'),
  )
  const last = pageRows.at(-1)
  return yield* decodeRow(
    ConversationPage,
    {
      items,
      nextCursor:
        hasNextPage && last !== undefined
          ? {
              activityAt: new Date(last.activityAt).toISOString(),
              conversationId: last.conversation.id,
            }
          : null,
    },
    'listConversationPage.decode',
  )
})

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
        sender:
          draft.fromAddressId === null
            ? {
                _tag: 'ExternalAccount',
                syncAccountId: draft.fromSyncAccountId,
              }
            : { _tag: 'GardenAddress', addressId: draft.fromAddressId },
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
        snippet: mailMessageSnippet(
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
          messageRows.at(-1)?.message.authorType === 'external' &&
          stateRows[0]?.lastReadMessageId === messages.at(-1)?.id &&
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
