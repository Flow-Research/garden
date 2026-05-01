import { sql } from 'drizzle-orm'
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization } from './workspaces.js'
import { user } from './users.js'

export const githubAppInstallation = pgTable(
  'github_app_installation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    installationId: text('installation_id').notNull(),
    accountLogin: text('account_login').notNull(),
    repositorySelection: text('repository_selection')
      .notNull()
      .default('selected'),
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
    uniqueIndex('github_app_installation_workspace_unique').on(
      table.workspaceId,
    ),
    check(
      'github_app_installation_status_check',
      sql`${table.status} in ('connected', 'degraded', 'disconnected')`,
    ),
  ],
)
