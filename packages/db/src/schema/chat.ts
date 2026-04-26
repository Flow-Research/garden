import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { agent } from './agents.js'
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
    title: text('title').notNull(),
    lastMessage: text('last_message').notNull().default(''),
    messages: jsonb('messages').notNull().default(sql`'[]'::jsonb`),
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
    check(
      'chat_thread_title_nonempty',
      sql`char_length(trim(${table.title})) > 0`,
    ),
  ],
)
