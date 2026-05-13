import { sql } from 'drizzle-orm'
import {
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
import { agent } from './agents.js'
import {
  automationConcurrencyPolicyValues,
  automationRunSourceValues,
  automationRunStatusValues,
  automationStatusValues,
  automationTriggerKindValues,
} from './automation-values.js'
import { issuePriorityValues } from './issue-values.js'
import { user } from './users.js'
import { organization } from './workspaces.js'

function sqlValueList(values: readonly string[]) {
  return sql.raw(
    values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', '),
  )
}

export const automation = pgTable(
  'automation',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    projectId: uuid('project_id'),
    title: text('title').notNull(),
    description: text('description'),
    assigneeAgentId: uuid('assignee_agent_id')
      .notNull()
      .references(() => agent.id),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('active'),
    concurrencyPolicy: text('concurrency_policy').notNull().default('skip'),
    lastRunAt: timestamp('last_run_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),

    // Prompt & input
    systemPrompt: text('system_prompt'),
    inputSchema: jsonb('input_schema'),
    contextSources: jsonb('context_sources'),

    // Output & execution
    outputConfig: jsonb('output_config'),
    executionConfig: jsonb('execution_config'),

    // Operations
    notificationConfig: jsonb('notification_config'),
    schedulingConfig: jsonb('scheduling_config'),

    // Organization
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    category: text('category'),
    templateSource: text('template_source'),

    // Analytics (denormalized for fast list queries)
    nextRunAt: timestamp('next_run_at', {
      mode: 'date',
      withTimezone: true,
    }),
    runCount: integer('run_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    skipCount: integer('skip_count').notNull().default(0),
    avgDurationMs: integer('avg_duration_ms'),

    // Authorship
    updatedBy: uuid('updated_by').references(() => user.id),
    metadata: jsonb('metadata'),
  },
  (table) => [
    index('automation_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    index('automation_next_run_idx').on(table.nextRunAt),
    index('automation_category_idx').on(table.category),
    index('automation_tags_gin').using('gin', table.tags),
    check(
      'automation_status_check',
      sql`${table.status} in (${sqlValueList(automationStatusValues)})`,
    ),
    check(
      'automation_priority_check',
      sql`${table.priority} in (${sqlValueList(issuePriorityValues)})`,
    ),
    check(
      'automation_concurrency_policy_check',
      sql`${table.concurrencyPolicy} in (${sqlValueList(automationConcurrencyPolicyValues)})`,
    ),
  ],
)

export const automationTrigger = pgTable(
  'automation_trigger',
  {
    id: uuid('id').primaryKey(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automation.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    label: text('label'),
    cronExpression: text('cron_expression'),
    timezone: text('timezone'),
    webhookTokenHash: text('webhook_token_hash'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('automation_trigger_automation_idx').on(table.automationId),
    index('automation_trigger_enabled_idx')
      .on(table.enabled)
      .where(sql`${table.kind} = 'schedule' and ${table.enabled} = true`),
    uniqueIndex('automation_trigger_webhook_token_unique')
      .on(table.webhookTokenHash)
      .where(sql`${table.webhookTokenHash} is not null`),
    check(
      'automation_trigger_kind_check',
      sql`${table.kind} in (${sqlValueList(automationTriggerKindValues)})`,
    ),
    check(
      'automation_trigger_schedule_fields_check',
      sql`(${table.kind} <> 'schedule') or (${table.cronExpression} is not null and ${table.timezone} is not null)`,
    ),
  ],
)

export const automationRun = pgTable(
  'automation_run',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automation.id, { onDelete: 'cascade' }),
    triggerId: uuid('trigger_id').references(() => automationTrigger.id, {
      onDelete: 'set null',
    }),
    source: text('source').notNull(),
    status: text('status').notNull().default('pending'),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    hostName: text('host_name').notNull(),
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
    triggeredAt: timestamp('triggered_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp('completed_at', {
      mode: 'date',
      withTimezone: true,
    }),
    failureReason: text('failure_reason'),
    triggerPayload: jsonb('trigger_payload'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('automation_run_workspace_idx').on(
      table.workspaceId,
      table.status,
      table.triggeredAt,
    ),
    index('automation_run_automation_idx').on(
      table.automationId,
      table.triggeredAt,
    ),
    index('automation_run_agent_active_idx')
      .on(table.agentId)
      .where(sql`${table.status} in ('queued', 'running')`),
    index('automation_run_workflow_idx')
      .on(table.workflowInstanceId)
      .where(sql`${table.workflowInstanceId} is not null`),
    check(
      'automation_run_source_check',
      sql`${table.source} in (${sqlValueList(automationRunSourceValues)})`,
    ),
    check(
      'automation_run_status_check',
      sql`${table.status} in (${sqlValueList(automationRunStatusValues)})`,
    ),
  ],
)
