import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { agent } from './agents.js'
import { capability } from './capabilities.js'
import { user } from './users.js'
import { organization } from './workspaces.js'

export const invocationLog = pgTable(
  'invocation_log',
  {
    id: uuid('id').primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capability.id),
    inputSummary: text('input_summary'),
    outputSummary: text('output_summary'),
    status: text('status'),
    latencyMs: integer('latency_ms'),
    tokenCount: integer('token_count'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('invocation_log_agent_created_at_idx').on(
      table.agentId,
      table.createdAt,
    ),
    index('invocation_log_capability_created_at_idx').on(
      table.capabilityId,
      table.createdAt,
    ),
  ],
)

export const toolCallAudit = pgTable(
  'tool_call_audit',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capability.id),
    toolCallId: text('tool_call_id').notNull(),
    argsHash: text('args_hash').notNull(),
    resultStatus: text('result_status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ts: timestamp('ts', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    error: text('error'),
  },
  (table) => [
    index('tool_call_audit_workspace_ts_idx').on(table.workspaceId, table.ts),
    index('tool_call_audit_capability_ts_idx').on(table.capabilityId, table.ts),
    check(
      'tool_call_audit_result_status_check',
      sql`${table.resultStatus} in ('success', 'error', 'denied', 'timeout')`,
    ),
  ],
)

export const activityEvent = pgTable(
  'activity_event',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('activity_event_workspace_created_at_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
)

export const connectorCallbackEvent = pgTable(
  'connector_callback_event',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, {
        onDelete: 'cascade',
      }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    connectorId: text('connector_id').notNull(),
    providerId: text('provider_id'),
    flowId: text('flow_id'),
    source: text('source').notNull(),
    status: text('status').notNull(),
    stage: text('stage').notNull().default('callback'),
    message: text('message'),
    errorCode: text('error_code'),
    accountLogin: text('account_login'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp('completed_at', { mode: 'date' }),
  },
  (table) => [
    index('connector_callback_event_workspace_created_at_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    index('connector_callback_event_flow_idx').on(table.flowId),
    index('connector_callback_event_connector_created_at_idx').on(
      table.connectorId,
      table.createdAt,
    ),
    check(
      'connector_callback_event_source_check',
      sql`${table.source} in ('oauth', 'github_app')`,
    ),
    check(
      'connector_callback_event_status_check',
      sql`${table.status} in ('success', 'degraded', 'error')`,
    ),
  ],
)
