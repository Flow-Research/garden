import { sql } from 'drizzle-orm'
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'
import { organization } from './workspaces.js'

/** One Garden-owned Discord bot installation per workspace. */
export const discordBotInstallation = pgTable(
  'discord_bot_installation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull(),
    guildName: text('guild_name').notNull(),
    guildIcon: text('guild_icon'),
    permissions: text('permissions'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').notNull().default('connected'),
    connectedBy: uuid('connected_by').references(() => user.id),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('discord_bot_installation_workspace_unique').on(
      table.workspaceId,
    ),
    check(
      'discord_bot_installation_status_check',
      sql`${table.status} in ('connected', 'degraded', 'disconnected')`,
    ),
  ],
)
