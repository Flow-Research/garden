import { sql } from 'drizzle-orm'
import {
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
import { workspace } from './workspaces.js'

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

export const activityEvent = pgTable(
  'activity_event',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
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
