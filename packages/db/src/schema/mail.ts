import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { agent } from './agents.js'
import { user } from './users.js'
import { member, organization } from './workspaces.js'

export const mailDomainStatusValues = [
  'pending_verification',
  'active',
  'suspended',
  'failed',
] as const
export const mailMailboxKindValues = ['personal', 'shared', 'agent'] as const
export const mailMailboxStatusValues = ['active', 'disabled'] as const
export const mailMailboxOriginValues = [
  'garden_hosted',
  'external_import',
] as const
export const mailSyncProviderValues = ['gmail'] as const
export const mailSyncAccountStatusValues = [
  'connected',
  'syncing',
  'ready',
  'degraded',
  'disconnected',
] as const
export const mailSyncRunTriggerValues = [
  'initial',
  'manual',
  'incremental',
  'recovery',
] as const
export const mailSyncRunStatusValues = [
  'queued',
  'enumerating',
  'importing',
  'completed',
  'failed',
  'cancelled',
] as const
export const mailSyncItemStatusValues = [
  'pending',
  'processing',
  'imported',
  'duplicate',
  'failed',
] as const
export const mailAddressKindValues = ['primary', 'alias', 'catch_all'] as const
export const mailAddressStatusValues = ['active', 'disabled'] as const
export const mailAccessActorTypeValues = ['member', 'agent'] as const
export const mailAccessLevelValues = ['owner', 'editor', 'viewer'] as const
export const mailMessageSourceValues = [
  'inbound',
  'outbound',
  'imported',
] as const
export const mailMessageAuthorTypeValues = [
  'external',
  'member',
  'agent',
  'system',
] as const
export const mailRecipientKindValues = ['to', 'cc', 'bcc'] as const
export const mailDraftStatusValues = [
  'editing',
  'awaiting_approval',
  'approved',
  'sending',
  'send_failed',
  'sent',
  'discarded',
] as const
export const mailDraftActivityActionValues = [
  'created',
  'edited',
  'submitted_for_approval',
  'approved',
  'changes_requested',
  'send_requested',
  'retry_requested',
  'send_failed',
  'sent',
  'discarded',
] as const
export const mailAttachmentDispositionValues = ['attachment', 'inline'] as const
export const mailDeliveryStatusValues = [
  'queued',
  'submitted',
  'delivered',
  'deferred',
  'bounced',
  'failed',
  'canceled',
] as const
export const mailConversationActorTypeValues = ['member', 'agent'] as const
export const mailActionActorTypeValues = ['member', 'agent', 'system'] as const

/** Produces an escaped SQL literal list for enum-like check constraints. */
function sqlValueList(values: readonly string[]) {
  return sql.raw(
    values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', '),
  )
}

/**
 * A company domain belongs to Garden even when DNS and transport are managed
 * by a replaceable provider. Only provider evidence is schemaless because its
 * proof records differ between Cloudflare and future self-hosted transports.
 */
export const mailDomain = pgTable(
  'mail_domain',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('pending_verification'),
    transportProvider: text('transport_provider').notNull(),
    providerDomainId: text('provider_domain_id'),
    providerEvidence:
      jsonb('provider_evidence').$type<Readonly<Record<string, unknown>>>(),
    verifiedAt: timestamp('verified_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('mail_domain_name_unique').on(table.name),
    unique('mail_domain_workspace_id_unique').on(table.workspaceId, table.id),
    index('mail_domain_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    check(
      'mail_domain_name_normalized_check',
      sql`${table.name} = lower(${table.name}) and ${table.name} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'`,
    ),
    check(
      'mail_domain_status_check',
      sql`${table.status} in (${sqlValueList(mailDomainStatusValues)})`,
    ),
    check(
      'mail_domain_transport_provider_check',
      sql`length(btrim(${table.transportProvider})) > 0`,
    ),
  ],
)

/** A Garden-owned mailbox is the collaboration and authorization boundary. */
export const mailMailbox = pgTable(
  'mail_mailbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    origin: text('origin').notNull().default('garden_hosted'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_mailbox_workspace_id_unique').on(table.workspaceId, table.id),
    index('mail_mailbox_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    check('mail_mailbox_name_check', sql`length(btrim(${table.name})) > 0`),
    check(
      'mail_mailbox_kind_check',
      sql`${table.kind} in (${sqlValueList(mailMailboxKindValues)})`,
    ),
    check(
      'mail_mailbox_status_check',
      sql`${table.status} in (${sqlValueList(mailMailboxStatusValues)})`,
    ),
    check(
      'mail_mailbox_origin_check',
      sql`${table.origin} in (${sqlValueList(mailMailboxOriginValues)})`,
    ),
  ],
)

/**
 * One connected provider account owns one external mailbox. Provider secrets
 * remain in Executor; this table stores only stable routing and sync cursors.
 */
export const mailSyncAccount = pgTable(
  'mail_sync_account',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailMailbox.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    provider: text('provider').notNull(),
    providerEmail: text('provider_email').notNull(),
    executorIntegration: text('executor_integration').notNull(),
    executorConnectionName: text('executor_connection_name').notNull(),
    status: text('status').notNull().default('connected'),
    historyId: text('history_id'),
    watchExpiration: timestamp('watch_expiration', {
      mode: 'date',
      withTimezone: true,
    }),
    lastSyncedAt: timestamp('last_synced_at', {
      mode: 'date',
      withTimezone: true,
    }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_sync_account_workspace_id_unique').on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex('mail_sync_account_mailbox_unique').on(table.mailboxId),
    uniqueIndex('mail_sync_account_workspace_provider_email_unique').on(
      table.workspaceId,
      table.provider,
      table.providerEmail,
    ),
    index('mail_sync_account_workspace_user_idx').on(
      table.workspaceId,
      table.userId,
    ),
    foreignKey({
      name: 'mail_sync_account_workspace_mailbox_fk',
      columns: [table.workspaceId, table.mailboxId],
      foreignColumns: [mailMailbox.workspaceId, mailMailbox.id],
    }),
    check(
      'mail_sync_account_provider_check',
      sql`${table.provider} in (${sqlValueList(mailSyncProviderValues)})`,
    ),
    check(
      'mail_sync_account_status_check',
      sql`${table.status} in (${sqlValueList(mailSyncAccountStatusValues)})`,
    ),
    check(
      'mail_sync_account_email_normalized_check',
      sql`${table.providerEmail} = lower(${table.providerEmail}) and ${table.providerEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'`,
    ),
    check(
      'mail_sync_account_executor_identity_check',
      sql`length(btrim(${table.executorIntegration})) > 0 and length(btrim(${table.executorConnectionName})) > 0`,
    ),
  ],
)

/** Cloudflare Workflow execution ledger with exact, transactionally settled counts. */
export const mailSyncRun = pgTable(
  'mail_sync_run',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    syncAccountId: uuid('sync_account_id')
      .notNull()
      .references(() => mailSyncAccount.id),
    workflowInstanceId: text('workflow_instance_id').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('queued'),
    totalMessages: integer('total_messages'),
    processedMessages: integer('processed_messages').notNull().default(0),
    importedMessages: integer('imported_messages').notNull().default(0),
    duplicateMessages: integer('duplicate_messages').notNull().default(0),
    failedMessages: integer('failed_messages').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { mode: 'date', withTimezone: true }),
    completedAt: timestamp('completed_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_sync_run_workspace_id_unique').on(table.workspaceId, table.id),
    uniqueIndex('mail_sync_run_workflow_instance_unique').on(
      table.workflowInstanceId,
    ),
    uniqueIndex('mail_sync_run_account_active_unique')
      .on(table.syncAccountId)
      .where(sql`${table.status} in ('queued', 'enumerating', 'importing')`),
    index('mail_sync_run_account_created_idx').on(
      table.syncAccountId,
      table.createdAt,
    ),
    foreignKey({
      name: 'mail_sync_run_workspace_account_fk',
      columns: [table.workspaceId, table.syncAccountId],
      foreignColumns: [mailSyncAccount.workspaceId, mailSyncAccount.id],
    }),
    check(
      'mail_sync_run_trigger_check',
      sql`${table.trigger} in (${sqlValueList(mailSyncRunTriggerValues)})`,
    ),
    check(
      'mail_sync_run_status_check',
      sql`${table.status} in (${sqlValueList(mailSyncRunStatusValues)})`,
    ),
    check(
      'mail_sync_run_counts_check',
      sql`${table.totalMessages} is null or ${table.totalMessages} >= 0`,
    ),
    check(
      'mail_sync_run_settled_counts_check',
      sql`${table.processedMessages} >= 0 and ${table.importedMessages} >= 0 and ${table.duplicateMessages} >= 0 and ${table.failedMessages} >= 0 and ${table.processedMessages} = ${table.importedMessages} + ${table.duplicateMessages} + ${table.failedMessages}`,
    ),
  ],
)

/**
 * An address maps an Internet-visible local part to exactly one Garden
 * mailbox. Catch-all routing is represented by the reserved `*` local part.
 */
export const mailAddress = pgTable(
  'mail_address',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomain.id),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailMailbox.id),
    localPart: text('local_part').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_address_workspace_id_unique').on(table.workspaceId, table.id),
    unique('mail_address_mailbox_id_unique').on(table.mailboxId, table.id),
    uniqueIndex('mail_address_domain_local_part_unique').on(
      table.domainId,
      table.localPart,
    ),
    uniqueIndex('mail_address_mailbox_primary_unique')
      .on(table.mailboxId)
      .where(sql`${table.kind} = 'primary'`),
    index('mail_address_workspace_mailbox_idx').on(
      table.workspaceId,
      table.mailboxId,
    ),
    foreignKey({
      name: 'mail_address_workspace_domain_fk',
      columns: [table.workspaceId, table.domainId],
      foreignColumns: [mailDomain.workspaceId, mailDomain.id],
    }),
    foreignKey({
      name: 'mail_address_workspace_mailbox_fk',
      columns: [table.workspaceId, table.mailboxId],
      foreignColumns: [mailMailbox.workspaceId, mailMailbox.id],
    }),
    check(
      'mail_address_local_part_normalized_check',
      sql`${table.localPart} = lower(${table.localPart}) and (${table.localPart} = '*' or ${table.localPart} ~ '^[a-z0-9][a-z0-9._%+-]*$')`,
    ),
    check(
      'mail_address_kind_check',
      sql`${table.kind} in (${sqlValueList(mailAddressKindValues)})`,
    ),
    check(
      'mail_address_catch_all_check',
      sql`(${table.kind} = 'catch_all') = (${table.localPart} = '*')`,
    ),
    check(
      'mail_address_status_check',
      sql`${table.status} in (${sqlValueList(mailAddressStatusValues)})`,
    ),
  ],
)

/**
 * Mail access treats workspace members and agents as first-class actors while
 * retaining real foreign keys for both actor kinds.
 */
export const mailMailboxAccess = pgTable(
  'mail_mailbox_access',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailMailbox.id),
    actorType: text('actor_type').notNull(),
    memberId: uuid('member_id').references(() => member.id),
    agentId: uuid('agent_id').references(() => agent.id),
    accessLevel: text('access_level').notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('mail_mailbox_access_member_unique')
      .on(table.mailboxId, table.memberId)
      .where(sql`${table.memberId} is not null`),
    uniqueIndex('mail_mailbox_access_agent_unique')
      .on(table.mailboxId, table.agentId)
      .where(sql`${table.agentId} is not null`),
    index('mail_mailbox_access_workspace_actor_idx').on(
      table.workspaceId,
      table.actorType,
    ),
    foreignKey({
      name: 'mail_mailbox_access_workspace_mailbox_fk',
      columns: [table.workspaceId, table.mailboxId],
      foreignColumns: [mailMailbox.workspaceId, mailMailbox.id],
    }),
    check(
      'mail_mailbox_access_actor_type_check',
      sql`${table.actorType} in (${sqlValueList(mailAccessActorTypeValues)})`,
    ),
    check(
      'mail_mailbox_access_actor_check',
      sql`(${table.actorType} = 'member' and ${table.memberId} is not null and ${table.agentId} is null) or (${table.actorType} = 'agent' and ${table.agentId} is not null and ${table.memberId} is null)`,
    ),
    check(
      'mail_mailbox_access_level_check',
      sql`${table.accessLevel} in (${sqlValueList(mailAccessLevelValues)})`,
    ),
  ],
)

/** A conversation is mailbox-local so private mailbox history cannot leak. */
export const mailConversation = pgTable(
  'mail_conversation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailMailbox.id),
    threadKey: text('thread_key').notNull(),
    subject: text('subject').notNull().default(''),
    normalizedSubject: text('normalized_subject').notNull().default(''),
    lastMessageAt: timestamp('last_message_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_conversation_workspace_id_unique').on(
      table.workspaceId,
      table.id,
    ),
    unique('mail_conversation_mailbox_id_unique').on(table.mailboxId, table.id),
    uniqueIndex('mail_conversation_mailbox_thread_key_unique').on(
      table.mailboxId,
      table.threadKey,
    ),
    index('mail_conversation_mailbox_activity_idx').on(
      table.mailboxId,
      table.lastMessageAt,
    ),
    index('mail_conversation_workspace_activity_idx').on(
      table.workspaceId,
      table.lastMessageAt,
    ),
    foreignKey({
      name: 'mail_conversation_workspace_mailbox_fk',
      columns: [table.workspaceId, table.mailboxId],
      foreignColumns: [mailMailbox.workspaceId, mailMailbox.id],
    }),
    check(
      'mail_conversation_thread_key_check',
      sql`length(btrim(${table.threadKey})) > 0`,
    ),
  ],
)

/**
 * Authored messages are immutable facts. Transport state deliberately lives
 * in `mail_delivery_attempt`, so retries never rewrite message authorship.
 */
export const mailMessage = pgTable(
  'mail_message',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    source: text('source').notNull(),
    authorType: text('author_type').notNull(),
    authorMemberId: uuid('author_member_id').references(() => member.id),
    authorAgentId: uuid('author_agent_id').references(() => agent.id),
    senderName: text('sender_name'),
    senderAddressId: uuid('sender_address_id').references(() => mailAddress.id),
    senderSyncAccountId: uuid('sender_sync_account_id').references(
      () => mailSyncAccount.id,
    ),
    senderAddress: text('sender_address').notNull(),
    subject: text('subject').notNull().default(''),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    internetMessageId: text('internet_message_id'),
    inReplyToMessageId: text('in_reply_to_message_id'),
    referenceMessageIds: text('reference_message_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    replyToMessageId: uuid('reply_to_message_id').references(
      (): AnyPgColumn => mailMessage.id,
    ),
    ingressProvider: text('ingress_provider'),
    ingressProviderMessageId: text('ingress_provider_message_id'),
    ingressProviderEvidence: jsonb('ingress_provider_evidence').$type<
      Readonly<Record<string, unknown>>
    >(),
    rawStorageKey: text('raw_storage_key'),
    authoredAt: timestamp('authored_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_message_workspace_id_unique').on(table.workspaceId, table.id),
    uniqueIndex('mail_message_ingress_identity_unique')
      .on(
        table.workspaceId,
        table.ingressProvider,
        table.ingressProviderMessageId,
      )
      .where(sql`${table.ingressProviderMessageId} is not null`),
    index('mail_message_workspace_internet_id_idx').on(
      table.workspaceId,
      table.internetMessageId,
    ),
    index('mail_message_reply_to_idx').on(table.replyToMessageId),
    index('mail_message_workspace_authored_at_idx').on(
      table.workspaceId,
      table.authoredAt,
    ),
    foreignKey({
      name: 'mail_message_workspace_sender_address_fk',
      columns: [table.workspaceId, table.senderAddressId],
      foreignColumns: [mailAddress.workspaceId, mailAddress.id],
    }),
    foreignKey({
      name: 'mail_message_workspace_sender_sync_account_fk',
      columns: [table.workspaceId, table.senderSyncAccountId],
      foreignColumns: [mailSyncAccount.workspaceId, mailSyncAccount.id],
    }),
    check(
      'mail_message_source_check',
      sql`${table.source} in (${sqlValueList(mailMessageSourceValues)})`,
    ),
    check(
      'mail_message_author_type_check',
      sql`${table.authorType} in (${sqlValueList(mailMessageAuthorTypeValues)})`,
    ),
    check(
      'mail_message_author_check',
      sql`(${table.authorType} = 'member' and ${table.authorMemberId} is not null and ${table.authorAgentId} is null) or (${table.authorType} = 'agent' and ${table.authorAgentId} is not null and ${table.authorMemberId} is null) or (${table.authorType} in ('external', 'system') and ${table.authorMemberId} is null and ${table.authorAgentId} is null)`,
    ),
    check(
      'mail_message_sender_address_normalized_check',
      sql`${table.senderAddress} = lower(${table.senderAddress}) and ${table.senderAddress} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    ),
    check(
      'mail_message_ingress_identity_pair_check',
      sql`(${table.ingressProvider} is null) = (${table.ingressProviderMessageId} is null)`,
    ),
    check(
      'mail_message_ingress_source_check',
      sql`${table.source} = 'outbound' or (${table.ingressProvider} is not null and ${table.ingressProviderMessageId} is not null)`,
    ),
    check(
      'mail_message_outbound_sender_check',
      sql`${table.source} <> 'outbound' or ((${table.senderAddressId} is not null)::int + (${table.senderSyncAccountId} is not null)::int = 1)`,
    ),
  ],
)

/**
 * Enumerated provider messages are durable Workflow work items. A stable claim
 * key makes a retried Workflow step recover the same batch instead of skipping it.
 */
export const mailSyncItem = pgTable(
  'mail_sync_item',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => mailSyncRun.id),
    providerMessageId: text('provider_message_id').notNull(),
    providerThreadId: text('provider_thread_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    status: text('status').notNull().default('pending'),
    claimKey: text('claim_key'),
    messageId: uuid('message_id').references(() => mailMessage.id),
    error: text('error'),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.providerMessageId] }),
    uniqueIndex('mail_sync_item_run_ordinal_unique').on(
      table.runId,
      table.ordinal,
    ),
    index('mail_sync_item_run_status_ordinal_idx').on(
      table.runId,
      table.status,
      table.ordinal,
    ),
    index('mail_sync_item_run_claim_idx').on(table.runId, table.claimKey),
    foreignKey({
      name: 'mail_sync_item_workspace_run_fk',
      columns: [table.workspaceId, table.runId],
      foreignColumns: [mailSyncRun.workspaceId, mailSyncRun.id],
    }),
    foreignKey({
      name: 'mail_sync_item_workspace_message_fk',
      columns: [table.workspaceId, table.messageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    check(
      'mail_sync_item_status_check',
      sql`${table.status} in (${sqlValueList(mailSyncItemStatusValues)})`,
    ),
    check('mail_sync_item_ordinal_check', sql`${table.ordinal} >= 0`),
    check(
      'mail_sync_item_identity_check',
      sql`length(btrim(${table.providerMessageId})) > 0 and length(btrim(${table.providerThreadId})) > 0`,
    ),
    check(
      'mail_sync_item_claim_check',
      sql`(${table.status} = 'pending' and ${table.claimKey} is null) or (${table.status} <> 'pending' and ${table.claimKey} is not null)`,
    ),
    check(
      'mail_sync_item_result_check',
      sql`(${table.status} in ('imported', 'duplicate') and ${table.messageId} is not null and ${table.error} is null) or (${table.status} = 'failed' and ${table.error} is not null) or (${table.status} in ('pending', 'processing') and ${table.messageId} is null and ${table.error} is null)`,
    ),
  ],
)

/**
 * A canonical message may be projected into multiple mailbox-local
 * conversations when several Garden addresses receive the same envelope.
 */
export const mailConversationMessage = pgTable(
  'mail_conversation_message',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => mailConversation.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => mailMessage.id),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({
      name: 'mail_conversation_message_pk',
      columns: [table.conversationId, table.messageId],
    }),
    index('mail_conversation_message_message_idx').on(table.messageId),
    foreignKey({
      name: 'mail_conversation_message_workspace_conversation_fk',
      columns: [table.workspaceId, table.conversationId],
      foreignColumns: [mailConversation.workspaceId, mailConversation.id],
    }),
    foreignKey({
      name: 'mail_conversation_message_workspace_message_fk',
      columns: [table.workspaceId, table.messageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
  ],
)

/** Envelope recipients preserve the original addressing and local matches. */
export const mailRecipient = pgTable(
  'mail_recipient',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => mailMessage.id),
    kind: text('kind').notNull(),
    position: integer('position').notNull(),
    displayName: text('display_name'),
    address: text('address').notNull(),
  },
  (table) => [
    uniqueIndex('mail_recipient_message_kind_position_unique').on(
      table.messageId,
      table.kind,
      table.position,
    ),
    foreignKey({
      name: 'mail_recipient_workspace_message_fk',
      columns: [table.workspaceId, table.messageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    check(
      'mail_recipient_kind_check',
      sql`${table.kind} in (${sqlValueList(mailRecipientKindValues)})`,
    ),
    check('mail_recipient_position_check', sql`${table.position} >= 0`),
    check(
      'mail_recipient_address_normalized_check',
      sql`${table.address} = lower(${table.address}) and ${table.address} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    ),
  ],
)

/** Ordered RFC Reply-To mailboxes retained separately from recipients. */
export const mailMessageReplyTo = pgTable(
  'mail_message_reply_to',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => mailMessage.id),
    position: integer('position').notNull(),
    displayName: text('display_name'),
    address: text('address').notNull(),
  },
  (table) => [
    uniqueIndex('mail_message_reply_to_message_position_unique').on(
      table.messageId,
      table.position,
    ),
    foreignKey({
      name: 'mail_message_reply_to_workspace_message_fk',
      columns: [table.workspaceId, table.messageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    check('mail_message_reply_to_position_check', sql`${table.position} >= 0`),
    check(
      'mail_message_reply_to_address_normalized_check',
      sql`${table.address} = lower(${table.address}) and ${table.address} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    ),
  ],
)

/**
 * Private SMTP-envelope routing. Unlike MIME To/Cc/Bcc recipients, these rows
 * are never message-visible data: they only decide which local mailboxes get a
 * conversation projection. This prevents one local recipient learning another
 * hidden envelope or Bcc destination.
 */
export const mailMessageLocalDelivery = pgTable(
  'mail_message_local_delivery',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => mailMessage.id),
    localAddressId: uuid('local_address_id')
      .notNull()
      .references(() => mailAddress.id),
    envelopeAddress: text('envelope_address').notNull(),
    providerRecipientId: text('provider_recipient_id'),
    providerEvidence:
      jsonb('provider_evidence').$type<Readonly<Record<string, unknown>>>(),
    receivedAt: timestamp('received_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('mail_message_local_delivery_message_address_unique').on(
      table.messageId,
      table.localAddressId,
    ),
    index('mail_message_local_delivery_address_received_idx').on(
      table.localAddressId,
      table.receivedAt,
    ),
    foreignKey({
      name: 'mail_message_local_delivery_workspace_message_fk',
      columns: [table.workspaceId, table.messageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    foreignKey({
      name: 'mail_message_local_delivery_workspace_address_fk',
      columns: [table.workspaceId, table.localAddressId],
      foreignColumns: [mailAddress.workspaceId, mailAddress.id],
    }),
    check(
      'mail_message_local_delivery_envelope_address_check',
      sql`${table.envelopeAddress} = lower(${table.envelopeAddress}) and ${table.envelopeAddress} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    ),
  ],
)

/** Drafts are mutable collaboration artifacts until converted to a message. */
export const mailDraft = pgTable(
  'mail_draft',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailMailbox.id),
    fromAddressId: uuid('from_address_id').references(() => mailAddress.id),
    fromSyncAccountId: uuid('from_sync_account_id').references(
      () => mailSyncAccount.id,
    ),
    conversationId: uuid('conversation_id').references(
      () => mailConversation.id,
    ),
    authorType: text('author_type').notNull(),
    authorMemberId: uuid('author_member_id').references(() => member.id),
    authorAgentId: uuid('author_agent_id').references(() => agent.id),
    replyToMessageId: uuid('reply_to_message_id').references(
      () => mailMessage.id,
    ),
    sentMessageId: uuid('sent_message_id').references(() => mailMessage.id),
    status: text('status').notNull().default('editing'),
    revision: integer('revision').notNull().default(0),
    subject: text('subject').notNull().default(''),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_draft_workspace_id_unique').on(table.workspaceId, table.id),
    uniqueIndex('mail_draft_sent_message_unique')
      .on(table.sentMessageId)
      .where(sql`${table.sentMessageId} is not null`),
    index('mail_draft_conversation_status_idx').on(
      table.conversationId,
      table.status,
    ),
    index('mail_draft_workspace_updated_at_idx').on(
      table.workspaceId,
      table.updatedAt,
    ),
    foreignKey({
      name: 'mail_draft_workspace_mailbox_fk',
      columns: [table.workspaceId, table.mailboxId],
      foreignColumns: [mailMailbox.workspaceId, mailMailbox.id],
    }),
    foreignKey({
      name: 'mail_draft_workspace_from_address_fk',
      columns: [table.workspaceId, table.fromAddressId],
      foreignColumns: [mailAddress.workspaceId, mailAddress.id],
    }),
    foreignKey({
      name: 'mail_draft_mailbox_from_address_fk',
      columns: [table.mailboxId, table.fromAddressId],
      foreignColumns: [mailAddress.mailboxId, mailAddress.id],
    }),
    foreignKey({
      name: 'mail_draft_workspace_from_sync_account_fk',
      columns: [table.workspaceId, table.fromSyncAccountId],
      foreignColumns: [mailSyncAccount.workspaceId, mailSyncAccount.id],
    }),
    foreignKey({
      name: 'mail_draft_workspace_conversation_fk',
      columns: [table.workspaceId, table.conversationId],
      foreignColumns: [mailConversation.workspaceId, mailConversation.id],
    }),
    foreignKey({
      name: 'mail_draft_mailbox_conversation_fk',
      columns: [table.mailboxId, table.conversationId],
      foreignColumns: [mailConversation.mailboxId, mailConversation.id],
    }),
    foreignKey({
      name: 'mail_draft_workspace_reply_to_fk',
      columns: [table.workspaceId, table.replyToMessageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    foreignKey({
      name: 'mail_draft_workspace_sent_message_fk',
      columns: [table.workspaceId, table.sentMessageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    foreignKey({
      name: 'mail_draft_conversation_reply_to_fk',
      columns: [table.conversationId, table.replyToMessageId],
      foreignColumns: [
        mailConversationMessage.conversationId,
        mailConversationMessage.messageId,
      ],
    }),
    foreignKey({
      name: 'mail_draft_conversation_sent_message_fk',
      columns: [table.conversationId, table.sentMessageId],
      foreignColumns: [
        mailConversationMessage.conversationId,
        mailConversationMessage.messageId,
      ],
    }),
    check(
      'mail_draft_author_type_check',
      sql`${table.authorType} in (${sqlValueList(mailAccessActorTypeValues)})`,
    ),
    check(
      'mail_draft_sender_check',
      sql`(${table.fromAddressId} is not null)::int + (${table.fromSyncAccountId} is not null)::int = 1`,
    ),
    check(
      'mail_draft_author_check',
      sql`(${table.authorType} = 'member' and ${table.authorMemberId} is not null and ${table.authorAgentId} is null) or (${table.authorType} = 'agent' and ${table.authorAgentId} is not null and ${table.authorMemberId} is null)`,
    ),
    check(
      'mail_draft_status_check',
      sql`${table.status} in (${sqlValueList(mailDraftStatusValues)})`,
    ),
    check('mail_draft_revision_check', sql`${table.revision} >= 0`),
    check(
      'mail_draft_reply_conversation_check',
      sql`${table.replyToMessageId} is null or ${table.conversationId} is not null`,
    ),
    check(
      'mail_draft_sent_conversation_check',
      sql`${table.sentMessageId} is null or ${table.conversationId} is not null`,
    ),
    check(
      'mail_draft_sent_message_check',
      sql`(${table.status} = 'sent') = (${table.sentMessageId} is not null)`,
    ),
  ],
)

/** Mutable draft addressing is normalized rather than hidden in JSON. */
export const mailDraftRecipient = pgTable(
  'mail_draft_recipient',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => mailDraft.id),
    kind: text('kind').notNull(),
    position: integer('position').notNull(),
    displayName: text('display_name'),
    address: text('address').notNull(),
  },
  (table) => [
    uniqueIndex('mail_draft_recipient_draft_kind_position_unique').on(
      table.draftId,
      table.kind,
      table.position,
    ),
    foreignKey({
      name: 'mail_draft_recipient_workspace_draft_fk',
      columns: [table.workspaceId, table.draftId],
      foreignColumns: [mailDraft.workspaceId, mailDraft.id],
    }),
    check(
      'mail_draft_recipient_kind_check',
      sql`${table.kind} in (${sqlValueList(mailRecipientKindValues)})`,
    ),
    check('mail_draft_recipient_position_check', sql`${table.position} >= 0`),
    check(
      'mail_draft_recipient_address_normalized_check',
      sql`${table.address} = lower(${table.address}) and ${table.address} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    ),
  ],
)

/**
 * Immutable draft activity preserves who edited, approved, or initiated a
 * send. The draft row remains the current projection; this ledger is history.
 */
export const mailDraftActivity = pgTable(
  'mail_draft_activity',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => mailDraft.id),
    sequence: integer('sequence').notNull(),
    revision: integer('revision').notNull(),
    actorType: text('actor_type').notNull(),
    memberId: uuid('member_id').references(() => member.id),
    agentId: uuid('agent_id').references(() => agent.id),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    sentMessageId: uuid('sent_message_id').references(() => mailMessage.id),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('mail_draft_activity_draft_sequence_unique').on(
      table.draftId,
      table.sequence,
    ),
    index('mail_draft_activity_workspace_actor_idx').on(
      table.workspaceId,
      table.actorType,
      table.createdAt,
    ),
    foreignKey({
      name: 'mail_draft_activity_workspace_draft_fk',
      columns: [table.workspaceId, table.draftId],
      foreignColumns: [mailDraft.workspaceId, mailDraft.id],
    }),
    foreignKey({
      name: 'mail_draft_activity_workspace_sent_message_fk',
      columns: [table.workspaceId, table.sentMessageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    check('mail_draft_activity_sequence_check', sql`${table.sequence} > 0`),
    check('mail_draft_activity_revision_check', sql`${table.revision} >= 0`),
    check(
      'mail_draft_activity_actor_type_check',
      sql`${table.actorType} in (${sqlValueList(mailActionActorTypeValues)})`,
    ),
    check(
      'mail_draft_activity_actor_check',
      sql`(${table.actorType} = 'member' and ${table.memberId} is not null and ${table.agentId} is null) or (${table.actorType} = 'agent' and ${table.agentId} is not null and ${table.memberId} is null) or (${table.actorType} = 'system' and ${table.memberId} is null and ${table.agentId} is null)`,
    ),
    check(
      'mail_draft_activity_action_check',
      sql`${table.action} in (${sqlValueList(mailDraftActivityActionValues)})`,
    ),
    check(
      'mail_draft_activity_from_status_check',
      sql`${table.fromStatus} is null or ${table.fromStatus} in (${sqlValueList(mailDraftStatusValues)})`,
    ),
    check(
      'mail_draft_activity_to_status_check',
      sql`${table.toStatus} in (${sqlValueList(mailDraftStatusValues)})`,
    ),
    check(
      'mail_draft_activity_created_check',
      sql`(${table.action} = 'created') = (${table.fromStatus} is null)`,
    ),
    check(
      'mail_draft_activity_sent_message_check',
      sql`(${table.action} = 'sent') = (${table.sentMessageId} is not null)`,
    ),
  ],
)

/** Blob metadata is immutable and storage-provider-neutral. */
export const mailAttachment = pgTable(
  'mail_attachment',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('mail_attachment_workspace_id_unique').on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex('mail_attachment_workspace_storage_key_unique').on(
      table.workspaceId,
      table.storageKey,
    ),
    index('mail_attachment_workspace_hash_idx').on(
      table.workspaceId,
      table.contentHash,
    ),
    check(
      'mail_attachment_file_name_check',
      sql`length(btrim(${table.fileName})) > 0`,
    ),
    check(
      'mail_attachment_content_type_check',
      sql`length(btrim(${table.contentType})) > 0`,
    ),
    check('mail_attachment_size_check', sql`${table.sizeBytes} >= 0`),
    check(
      'mail_attachment_hash_check',
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
)

export const mailMessageAttachment = pgTable(
  'mail_message_attachment',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => mailMessage.id),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => mailAttachment.id),
    disposition: text('disposition').notNull(),
    contentId: text('content_id'),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'mail_message_attachment_pk',
      columns: [table.messageId, table.attachmentId],
    }),
    uniqueIndex('mail_message_attachment_position_unique').on(
      table.messageId,
      table.position,
    ),
    foreignKey({
      name: 'mail_message_attachment_workspace_message_fk',
      columns: [table.workspaceId, table.messageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    foreignKey({
      name: 'mail_message_attachment_workspace_attachment_fk',
      columns: [table.workspaceId, table.attachmentId],
      foreignColumns: [mailAttachment.workspaceId, mailAttachment.id],
    }),
    check(
      'mail_message_attachment_disposition_check',
      sql`${table.disposition} in (${sqlValueList(mailAttachmentDispositionValues)})`,
    ),
    check(
      'mail_message_attachment_position_check',
      sql`${table.position} >= 0`,
    ),
    check(
      'mail_message_attachment_content_id_check',
      sql`${table.disposition} = 'inline' or ${table.contentId} is null`,
    ),
  ],
)

export const mailDraftAttachment = pgTable(
  'mail_draft_attachment',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => mailDraft.id),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => mailAttachment.id),
    disposition: text('disposition').notNull(),
    contentId: text('content_id'),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'mail_draft_attachment_pk',
      columns: [table.draftId, table.attachmentId],
    }),
    uniqueIndex('mail_draft_attachment_position_unique').on(
      table.draftId,
      table.position,
    ),
    foreignKey({
      name: 'mail_draft_attachment_workspace_draft_fk',
      columns: [table.workspaceId, table.draftId],
      foreignColumns: [mailDraft.workspaceId, mailDraft.id],
    }),
    foreignKey({
      name: 'mail_draft_attachment_workspace_attachment_fk',
      columns: [table.workspaceId, table.attachmentId],
      foreignColumns: [mailAttachment.workspaceId, mailAttachment.id],
    }),
    check(
      'mail_draft_attachment_disposition_check',
      sql`${table.disposition} in (${sqlValueList(mailAttachmentDispositionValues)})`,
    ),
    check('mail_draft_attachment_position_check', sql`${table.position} >= 0`),
    check(
      'mail_draft_attachment_content_id_check',
      sql`${table.disposition} = 'inline' or ${table.contentId} is null`,
    ),
  ],
)

/** Delivery attempts carry mutable transport outcomes, never message content. */
export const mailDeliveryAttempt = pgTable(
  'mail_delivery_attempt',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => mailMessage.id),
    attemptNumber: integer('attempt_number').notNull(),
    provider: text('provider').notNull(),
    providerAttemptId: text('provider_attempt_id'),
    status: text('status').notNull().default('queued'),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    providerEvidence:
      jsonb('provider_evidence').$type<Readonly<Record<string, unknown>>>(),
    nextAttemptAt: timestamp('next_attempt_at', {
      mode: 'date',
      withTimezone: true,
    }),
    submittedAt: timestamp('submitted_at', {
      mode: 'date',
      withTimezone: true,
    }),
    completedAt: timestamp('completed_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('mail_delivery_attempt_message_number_unique').on(
      table.messageId,
      table.attemptNumber,
    ),
    uniqueIndex('mail_delivery_attempt_provider_identity_unique')
      .on(table.provider, table.providerAttemptId)
      .where(sql`${table.providerAttemptId} is not null`),
    index('mail_delivery_attempt_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.nextAttemptAt,
    ),
    foreignKey({
      name: 'mail_delivery_attempt_workspace_message_fk',
      columns: [table.workspaceId, table.messageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    check(
      'mail_delivery_attempt_number_check',
      sql`${table.attemptNumber} > 0`,
    ),
    check(
      'mail_delivery_attempt_provider_check',
      sql`length(btrim(${table.provider})) > 0`,
    ),
    check(
      'mail_delivery_attempt_status_check',
      sql`${table.status} in (${sqlValueList(mailDeliveryStatusValues)})`,
    ),
    check(
      'mail_delivery_attempt_failure_check',
      sql`${table.status} in ('bounced', 'failed') or (${table.failureCode} is null and ${table.failureMessage} is null)`,
    ),
  ],
)

/** Read/archive state belongs to each member or agent, not the conversation. */
export const mailConversationState = pgTable(
  'mail_conversation_state',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => mailConversation.id),
    actorType: text('actor_type').notNull(),
    memberId: uuid('member_id').references(() => member.id),
    agentId: uuid('agent_id').references(() => agent.id),
    lastReadMessageId: uuid('last_read_message_id').references(
      () => mailMessage.id,
    ),
    readAt: timestamp('read_at', { mode: 'date', withTimezone: true }),
    archivedAt: timestamp('archived_at', {
      mode: 'date',
      withTimezone: true,
    }),
    mutedAt: timestamp('muted_at', { mode: 'date', withTimezone: true }),
    pinned: boolean('pinned').notNull().default(false),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('mail_conversation_state_member_unique')
      .on(table.conversationId, table.memberId)
      .where(sql`${table.memberId} is not null`),
    uniqueIndex('mail_conversation_state_agent_unique')
      .on(table.conversationId, table.agentId)
      .where(sql`${table.agentId} is not null`),
    index('mail_conversation_state_workspace_actor_idx').on(
      table.workspaceId,
      table.actorType,
    ),
    index('mail_conversation_state_member_inbox_idx')
      .on(table.workspaceId, table.memberId, table.archivedAt)
      .where(sql`${table.memberId} is not null`),
    index('mail_conversation_state_agent_inbox_idx')
      .on(table.workspaceId, table.agentId, table.archivedAt)
      .where(sql`${table.agentId} is not null`),
    foreignKey({
      name: 'mail_conversation_state_workspace_conversation_fk',
      columns: [table.workspaceId, table.conversationId],
      foreignColumns: [mailConversation.workspaceId, mailConversation.id],
    }),
    foreignKey({
      name: 'mail_conversation_state_workspace_last_read_message_fk',
      columns: [table.workspaceId, table.lastReadMessageId],
      foreignColumns: [mailMessage.workspaceId, mailMessage.id],
    }),
    foreignKey({
      name: 'mail_conversation_state_last_read_projection_fk',
      columns: [table.conversationId, table.lastReadMessageId],
      foreignColumns: [
        mailConversationMessage.conversationId,
        mailConversationMessage.messageId,
      ],
    }),
    check(
      'mail_conversation_state_actor_type_check',
      sql`${table.actorType} in (${sqlValueList(mailConversationActorTypeValues)})`,
    ),
    check(
      'mail_conversation_state_actor_check',
      sql`(${table.actorType} = 'member' and ${table.memberId} is not null and ${table.agentId} is null) or (${table.actorType} = 'agent' and ${table.agentId} is not null and ${table.memberId} is null)`,
    ),
  ],
)

/**
 * Conversation assignment is independent from mailbox access and per-actor
 * read state. Closed rows retain assignment and unassignment attribution.
 */
export const mailConversationAssignment = pgTable(
  'mail_conversation_assignment',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => mailConversation.id),
    assigneeType: text('assignee_type').notNull(),
    assigneeMemberId: uuid('assignee_member_id').references(() => member.id),
    assigneeAgentId: uuid('assignee_agent_id').references(() => agent.id),
    assignedByType: text('assigned_by_type').notNull(),
    assignedByMemberId: uuid('assigned_by_member_id').references(
      () => member.id,
    ),
    assignedByAgentId: uuid('assigned_by_agent_id').references(() => agent.id),
    assignedAt: timestamp('assigned_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    unassignedByType: text('unassigned_by_type'),
    unassignedByMemberId: uuid('unassigned_by_member_id').references(
      () => member.id,
    ),
    unassignedByAgentId: uuid('unassigned_by_agent_id').references(
      () => agent.id,
    ),
    unassignedAt: timestamp('unassigned_at', {
      mode: 'date',
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex('mail_conversation_assignment_active_member_unique')
      .on(table.conversationId, table.assigneeMemberId)
      .where(
        sql`${table.assigneeMemberId} is not null and ${table.unassignedAt} is null`,
      ),
    uniqueIndex('mail_conversation_assignment_active_agent_unique')
      .on(table.conversationId, table.assigneeAgentId)
      .where(
        sql`${table.assigneeAgentId} is not null and ${table.unassignedAt} is null`,
      ),
    index('mail_conversation_assignment_workspace_active_idx').on(
      table.workspaceId,
      table.unassignedAt,
      table.assignedAt,
    ),
    foreignKey({
      name: 'mail_conversation_assignment_workspace_conversation_fk',
      columns: [table.workspaceId, table.conversationId],
      foreignColumns: [mailConversation.workspaceId, mailConversation.id],
    }),
    check(
      'mail_conversation_assignment_assignee_type_check',
      sql`${table.assigneeType} in (${sqlValueList(mailConversationActorTypeValues)})`,
    ),
    check(
      'mail_conversation_assignment_assignee_check',
      sql`(${table.assigneeType} = 'member' and ${table.assigneeMemberId} is not null and ${table.assigneeAgentId} is null) or (${table.assigneeType} = 'agent' and ${table.assigneeAgentId} is not null and ${table.assigneeMemberId} is null)`,
    ),
    check(
      'mail_conversation_assignment_assigned_by_type_check',
      sql`${table.assignedByType} in (${sqlValueList(mailActionActorTypeValues)})`,
    ),
    check(
      'mail_conversation_assignment_assigned_by_check',
      sql`(${table.assignedByType} = 'member' and ${table.assignedByMemberId} is not null and ${table.assignedByAgentId} is null) or (${table.assignedByType} = 'agent' and ${table.assignedByAgentId} is not null and ${table.assignedByMemberId} is null) or (${table.assignedByType} = 'system' and ${table.assignedByMemberId} is null and ${table.assignedByAgentId} is null)`,
    ),
    check(
      'mail_conversation_assignment_unassigned_check',
      sql`(${table.unassignedAt} is null and ${table.unassignedByType} is null and ${table.unassignedByMemberId} is null and ${table.unassignedByAgentId} is null) or (${table.unassignedAt} is not null and ((${table.unassignedByType} = 'member' and ${table.unassignedByMemberId} is not null and ${table.unassignedByAgentId} is null) or (${table.unassignedByType} = 'agent' and ${table.unassignedByAgentId} is not null and ${table.unassignedByMemberId} is null) or (${table.unassignedByType} = 'system' and ${table.unassignedByMemberId} is null and ${table.unassignedByAgentId} is null)))`,
    ),
  ],
)
