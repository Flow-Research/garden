import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'
import { organization } from './workspaces.js'
import { agent } from './agents.js'
import {
  activeIssueRunStatusValues,
  connectorIdValues,
  inboxActorTypeValues,
  inboxRecipientTypeValues,
  inboxSeverityValues,
  issueCommentAuthorTypeValues,
  issueDbAssigneeTypeValues,
  issuePriorityValues,
  issueRunEventLevelValues,
  issueRunEventStreamValues,
  issueRunStatusValues,
  issueRunTriggerSourceValues,
  issueStatusValues,
  issueSubscriberReasonValues,
  issueSubscriberUserTypeValues,
  issueWorkProductReviewStateValues,
  issueWorkProductStatusValues,
  issueWorkProductTypeValues,
  sourceKindValues,
} from './issue-values.js'

function sqlValueList(values: readonly string[]) {
  return sql.raw(
    values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', '),
  )
}

export const issue = pgTable(
  'issue',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').default('todo'),
    priority: text('priority').default('medium'),
    assigneeType: text('assignee_type'),
    assigneeId: uuid('assignee_id'),
    position: integer('position').notNull().default(0),
    dueDate: timestamp('due_date', {
      mode: 'date',
      withTimezone: true,
    }),
    activeRunId: uuid('active_run_id').references(
      (): AnyPgColumn => issueRun.id,
    ),
    sourceSummary: text('source_summary'),
    permissionsOverride: jsonb('permissions_override'),
    labels: text('labels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    parentId: uuid('parent_id').references((): AnyPgColumn => issue.id),
    projectId: uuid('project_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    uniqueIndex('issue_workspace_number_unique').on(
      table.workspaceId,
      table.number,
    ),
    index('issue_workspace_status_idx').on(table.workspaceId, table.status),
    index('issue_workspace_active_run_idx').on(
      table.workspaceId,
      table.activeRunId,
    ),
    index('issue_workspace_position_idx').on(
      table.workspaceId,
      table.status,
      table.position,
    ),
    index('issue_workspace_assignee_idx').on(
      table.workspaceId,
      table.assigneeType,
      table.assigneeId,
    ),
    check(
      'issue_status_check',
      sql`${table.status} in (${sqlValueList(issueStatusValues)})`,
    ),
    check(
      'issue_priority_check',
      sql`${table.priority} in (${sqlValueList(issuePriorityValues)})`,
    ),
    check(
      'issue_assignee_type_check',
      sql`${table.assigneeType} is null or ${table.assigneeType} in (${sqlValueList(issueDbAssigneeTypeValues)})`,
    ),
  ],
)

export const issueComment = pgTable(
  'issue_comment',
  {
    id: uuid('id').primaryKey(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id),
    authorType: text('author_type').notNull(),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    mentions: jsonb('mentions'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('issue_comment_mentions_gin').using('gin', table.mentions),
    check(
      'issue_comment_author_type_check',
      sql`${table.authorType} in (${sqlValueList(issueCommentAuthorTypeValues)})`,
    ),
  ],
)

/**
 * Files uploaded into issue descriptions or comments.
 *
 * Why this exists: the editor already accepted image drops and the API payloads
 * already carried attachment ids, but there was no durable table to connect
 * those R2 objects to an issue/comment. Keeping both workspace_id and the
 * workspace-prefixed R2 key makes org ownership explicit at the database and
 * object-storage layers, matching the existing skills layout
 * (`agent-skills/workspaces/<workspaceId>/...`).
 */
export const issueAttachment = pgTable(
  'issue_attachment',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    issueId: uuid('issue_id').references(() => issue.id, {
      onDelete: 'cascade',
    }),
    commentId: uuid('comment_id').references(() => issueComment.id, {
      onDelete: 'cascade',
    }),
    uploaderType: text('uploader_type').notNull(),
    uploaderId: uuid('uploader_id').notNull(),
    filename: text('filename').notNull(),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('issue_attachment_workspace_idx').on(table.workspaceId),
    index('issue_attachment_issue_idx').on(table.issueId),
    index('issue_attachment_comment_idx').on(table.commentId),
    check(
      'issue_attachment_uploader_type_check',
      sql`${table.uploaderType} in ('member', 'agent')`,
    ),
  ],
)

/**
 * Persisted participant set for an issue ("who is on this issue").
 *
 * Why this exists: tagging an agent in a comment already kicks off a run
 * (see core/issues/triggers.ts → decideWakeups), but before this table there
 * was no durable record that the agent (or any member) had *joined* the issue —
 * the subscribers endpoint computed creator+assignee on the fly and the
 * subscribe/unsubscribe routes were no-ops. This table makes the join durable:
 * a row per (issue, participant), stamped with why they joined.
 *
 * `reason` is informational and first-write-wins — population uses
 * onConflictDoNothing so an explicit 'creator'/'assignee' isn't downgraded to
 * 'mentioned' on a later comment. Manual unsubscribe deletes the row.
 */
export const issueSubscriber = pgTable(
  'issue_subscriber',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    userType: text('user_type').notNull(),
    userId: uuid('user_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('issue_subscriber_issue_user_unique').on(
      table.issueId,
      table.userType,
      table.userId,
    ),
    index('issue_subscriber_issue_idx').on(table.issueId),
    check(
      'issue_subscriber_user_type_check',
      sql`${table.userType} in (${sqlValueList(issueSubscriberUserTypeValues)})`,
    ),
    check(
      'issue_subscriber_reason_check',
      sql`${table.reason} in (${sqlValueList(issueSubscriberReasonValues)})`,
    ),
  ],
)

export const issueSourceBinding = pgTable(
  'issue_source_binding',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    connectorId: text('connector_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url'),
    displayRef: text('display_ref'),
    titleSnapshot: text('title_snapshot'),
    metadata: jsonb('metadata'),
    lastSyncedAt: timestamp('last_synced_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('issue_source_binding_external_unique').on(
      table.workspaceId,
      table.connectorId,
      table.sourceKind,
      table.externalId,
    ),
    index('issue_source_binding_issue_idx').on(table.issueId),
    check(
      'issue_source_binding_connector_check',
      sql`${table.connectorId} in (${sqlValueList(connectorIdValues)})`,
    ),
    check(
      'issue_source_binding_kind_check',
      sql`${table.sourceKind} in (${sqlValueList(sourceKindValues)})`,
    ),
  ],
)

export const issueRun = pgTable(
  'issue_run',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, {
        onDelete: 'cascade',
      }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    hostName: text('host_name').notNull(),
    status: text('status').notNull().default('queued'),
    triggerSource: text('trigger_source'),
    triggerRef: jsonb('trigger_ref'),
    parentRunId: uuid('parent_run_id').references(
      (): AnyPgColumn => issueRun.id,
      {
        onDelete: 'set null',
      },
    ),
    workflowInstanceId: text('workflow_instance_id'),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      mode: 'date',
      withTimezone: true,
    }),
    contextSnapshot: jsonb('context_snapshot'),
    resultJson: jsonb('result_json'),
    usageJson: jsonb('usage_json'),
    error: text('error'),
    startedAt: timestamp('started_at', {
      mode: 'date',
      withTimezone: true,
    }),
    finishedAt: timestamp('finished_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('issue_run_issue_idx').on(table.issueId, table.createdAt),
    index('issue_run_agent_active_idx')
      .on(table.agentId)
      .where(
        sql`${table.status} in (${sqlValueList(activeIssueRunStatusValues)})`,
      ),
    index('issue_run_silent_idx')
      .on(table.status, table.updatedAt)
      .where(sql`${table.status} = 'running'`),
    index('issue_run_workflow_idx')
      .on(table.workflowInstanceId)
      .where(sql`${table.workflowInstanceId} is not null`),
    index('issue_run_parent_idx')
      .on(table.parentRunId)
      .where(sql`${table.parentRunId} is not null`),
    check(
      'issue_run_status_check',
      sql`${table.status} in (${sqlValueList(issueRunStatusValues)})`,
    ),
    check(
      'issue_run_trigger_source_check',
      sql`${table.triggerSource} is null or ${table.triggerSource} in (${sqlValueList(issueRunTriggerSourceValues)})`,
    ),
  ],
)

export const issueRunEvent = pgTable(
  'issue_run_event',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => issueRun.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    eventType: text('event_type').notNull(),
    stream: text('stream').notNull().default('system'),
    level: text('level').notNull().default('info'),
    message: text('message'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('issue_run_event_seq_unique').on(table.runId, table.seq),
    index('issue_run_event_issue_idx').on(table.issueId, table.createdAt),
    check(
      'issue_run_event_stream_check',
      sql`${table.stream} in (${sqlValueList(issueRunEventStreamValues)})`,
    ),
    check(
      'issue_run_event_level_check',
      sql`${table.level} in (${sqlValueList(issueRunEventLevelValues)})`,
    ),
  ],
)

export const issueWorkProduct = pgTable(
  'issue_work_product',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => issueRun.id, {
      onDelete: 'set null',
    }),
    agentId: uuid('agent_id').references(() => agent.id),
    type: text('type').notNull(),
    status: text('status').notNull().default('draft'),
    reviewState: text('review_state').notNull().default('pending'),
    isPrimary: boolean('is_primary').notNull().default(false),
    title: text('title'),
    body: text('body'),
    payload: jsonb('payload'),
    appliedAt: timestamp('applied_at', {
      mode: 'date',
      withTimezone: true,
    }),
    appliedExternalId: text('applied_external_id'),
    appliedExternalUrl: text('applied_external_url'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('issue_work_product_primary_unique')
      .on(table.issueId, table.type)
      .where(sql`${table.isPrimary} = true`),
    index('issue_work_product_issue_idx').on(table.issueId, table.createdAt),
    check(
      'issue_work_product_type_check',
      sql`${table.type} in (${sqlValueList(issueWorkProductTypeValues)})`,
    ),
    check(
      'issue_work_product_status_check',
      sql`${table.status} in (${sqlValueList(issueWorkProductStatusValues)})`,
    ),
    check(
      'issue_work_product_review_check',
      sql`${table.reviewState} in (${sqlValueList(issueWorkProductReviewStateValues)})`,
    ),
  ],
)

export const inboxDismissal = pgTable(
  'inbox_dismissal',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    itemKey: text('item_key').notNull(),
    dismissedAt: timestamp('dismissed_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('inbox_dismissal_workspace_user_item_unique').on(
      table.workspaceId,
      table.userId,
      table.itemKey,
    ),
    index('inbox_dismissal_user_idx').on(table.workspaceId, table.userId),
  ],
)

export const inboxItem = pgTable(
  'inbox_item',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    recipientType: text('recipient_type').notNull(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => user.id),
    itemKey: text('item_key').notNull(),
    actorType: text('actor_type'),
    actorId: uuid('actor_id'),
    type: text('type').notNull(),
    severity: text('severity').notNull().default('info'),
    issueId: uuid('issue_id').references(() => issue.id, {
      onDelete: 'cascade',
    }),
    issueStatus: text('issue_status'),
    title: text('title').notNull(),
    body: text('body'),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
    read: boolean('read').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    activityAt: timestamp('activity_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
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
    uniqueIndex('inbox_item_workspace_recipient_key_unique').on(
      table.workspaceId,
      table.recipientType,
      table.recipientId,
      table.itemKey,
    ),
    index('inbox_item_recipient_idx').on(
      table.workspaceId,
      table.recipientType,
      table.recipientId,
      table.archived,
      table.activityAt,
    ),
    index('inbox_item_issue_idx').on(table.workspaceId, table.issueId),
    check(
      'inbox_item_recipient_type_check',
      sql`${table.recipientType} in (${sqlValueList(inboxRecipientTypeValues)})`,
    ),
    check(
      'inbox_item_actor_type_check',
      sql`${table.actorType} is null or ${table.actorType} in (${sqlValueList(inboxActorTypeValues)})`,
    ),
    check(
      'inbox_item_severity_check',
      sql`${table.severity} in (${sqlValueList(inboxSeverityValues)})`,
    ),
  ],
)
