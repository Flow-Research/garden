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
import { user } from './users.js'
import { organization } from './workspaces.js'

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
    title: text('title').notNull(),
    agentName: text('agent_name').notNull(),
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
    check(
      'chat_thread_title_nonempty',
      sql`char_length(trim(${table.title})) > 0`,
    ),
  ],
)
