import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { agent } from './agents.js'
import { issue } from './issues.js'
import { user } from './users.js'
import { organization } from './workspaces.js'

// Threads bind to a specific `agent` row by id. The host DO name is derived
// from the agent row at the API edge (so the wire still carries a stable
// host identifier without duplicating it in this table).
export const chatThread = pgTable(
  'chat_thread',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => user.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    primaryIssueId: uuid('primary_issue_id').references(() => issue.id, {
      onDelete: 'set null',
    }),
    runtimeKind: text('runtime_kind').notNull().default('chat'),
    runtimeKey: uuid('runtime_key'),
    title: text('title').notNull(),
    lastMessage: text('last_message').notNull().default(''),
    archivedAt: timestamp('archived_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('chat_thread_workspace_owner_idx').on(
      table.workspaceId,
      table.ownerUserId,
    ),
    index('chat_thread_workspace_updated_idx').on(
      table.workspaceId,
      table.updatedAt,
    ),
    index('chat_thread_agent_idx').on(table.agentId),
    index('chat_thread_primary_issue_idx').on(table.primaryIssueId),
    index('chat_thread_runtime_idx').on(table.runtimeKind, table.runtimeKey),
    check(
      'chat_thread_runtime_kind_check',
      sql`${table.runtimeKind} in ('chat', 'issue_run')`,
    ),
    check(
      'chat_thread_title_nonempty',
      sql`char_length(trim(${table.title})) > 0`,
    ),
  ],
)
