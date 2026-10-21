import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'
import { organization } from './workspaces.js'

/**
 * Files & Folders (Penpot "Files & Folders [DEV READY]"): folders are
 * Garden-owned collaboration metadata. Brain file records themselves live in
 * Helix/R2 (see @garden/brain), so `brain_folder_file.file_id` stores the Helix
 * item id as plain text — there is deliberately no FK into a foreign system.
 */
export const brainFolder = pgTable(
  'brain_folder',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    privacy: text('privacy', { enum: ['private', 'shared'] })
      .notNull()
      .default('private'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    }).default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    }).default(sql`now()`),
  },
  (table) => [
    index('brain_folder_workspace_idx').on(table.workspaceId, table.privacy),
    check(
      'brain_folder_privacy_check',
      sql`${table.privacy} in ('private', 'shared')`,
    ),
    check(
      'brain_folder_name_length_check',
      sql`char_length(${table.name}) between 1 and 50`,
    ),
  ],
)

export const brainFolderFile = pgTable(
  'brain_folder_file',
  {
    folderId: uuid('folder_id')
      .notNull()
      .references(() => brainFolder.id, { onDelete: 'cascade' }),
    /** Helix brain item id (external system — intentionally not a FK). */
    fileId: text('file_id').notNull(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    }).default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.folderId, table.fileId] }),
    index('brain_folder_file_file_idx').on(table.fileId),
  ],
)
