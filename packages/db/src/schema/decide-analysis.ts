import { sql } from 'drizzle-orm'
import {
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
import { chatThread } from './chat.js'
import { user } from './users.js'
import { organization } from './workspaces.js'

export const decideAnalysisRun = pgTable(
  'decide_analysis_run',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => user.id),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThread.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    agentRuntimeName: text('agent_runtime_name').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    retryKey: text('retry_key'),
    workflowInstanceId: text('workflow_instance_id').notNull(),
    question: text('question').notNull(),
    inputData: text('input_data'),
    context: text('context'),
    providerSessionId: text('provider_session_id'),
    status: text('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(1),
    progressSequence: integer('progress_sequence').notNull().default(0),
    progressJson: jsonb('progress_json').$type<unknown>(),
    resultJson: jsonb('result_json').$type<unknown>(),
    errorJson: jsonb('error_json').$type<unknown>(),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      withTimezone: true,
      mode: 'date',
    }),
    providerCallStartedAt: timestamp('provider_call_started_at', {
      withTimezone: true,
      mode: 'date',
    }),
    startedAt: timestamp('started_at', {
      withTimezone: true,
      mode: 'date',
    }),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('decide_analysis_run_workspace_idempotency_idx').on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex('decide_analysis_run_workflow_instance_idx').on(
      table.workflowInstanceId,
    ),
    index('decide_analysis_run_thread_updated_idx').on(
      table.threadId,
      table.updatedAt,
    ),
    index('decide_analysis_run_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    check(
      'decide_analysis_run_status_check',
      sql`${table.status} in ('queued', 'running', 'cancel_requested', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'decide_analysis_run_attempt_positive_check',
      sql`${table.attempt} > 0`,
    ),
    check(
      'decide_analysis_run_progress_sequence_nonnegative_check',
      sql`${table.progressSequence} >= 0`,
    ),
  ],
)
