import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { chatThread } from './chat.js'
import { user } from './users.js'
import { organization } from './workspaces.js'

export const document = pgTable(
  'document',
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
    threadId: uuid('thread_id').references(() => chatThread.id),
    filename: text('filename').notNull(),
    fileType: text('file_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    pageCount: integer('page_count'),
    structureTree: jsonb('structure_tree').$type<unknown>(),
    status: text('status').notNull().default('processing'),
    currentVersionId: uuid('current_version_id'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('document_workspace_owner_idx').on(
      table.workspaceId,
      table.ownerUserId,
    ),
    index('document_thread_idx').on(table.threadId),
    index('document_current_version_idx').on(table.currentVersionId),
    check(
      'document_file_type_check',
      sql`${table.fileType} in ('pdf', 'doc', 'docx', 'txt', 'md', 'json', 'csv', 'unknown')`,
    ),
    check(
      'document_status_check',
      sql`${table.status} in ('processing', 'ready', 'failed')`,
    ),
  ],
)

export const documentVersion = pgTable(
  'document_version',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => document.id),
    storagePath: text('storage_path').notNull(),
    pdfStoragePath: text('pdf_storage_path'),
    source: text('source').notNull(),
    versionNumber: integer('version_number').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('document_version_document_idx').on(table.documentId),
    index('document_version_document_number_idx').on(
      table.documentId,
      table.versionNumber,
    ),
    check(
      'document_version_source_check',
      sql`${table.source} in ('upload', 'user_upload', 'assistant_edit', 'user_accept', 'user_reject', 'generated')`,
    ),
  ],
)

export const documentEdit = pgTable(
  'document_edit',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => document.id),
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentVersion.id),
    chatThreadId: uuid('chat_thread_id').references(() => chatThread.id),
    changeId: text('change_id').notNull(),
    delWId: text('del_w_id'),
    insWId: text('ins_w_id'),
    deletedText: text('deleted_text').notNull().default(''),
    insertedText: text('inserted_text').notNull().default(''),
    contextBefore: text('context_before').notNull().default(''),
    contextAfter: text('context_after').notNull().default(''),
    status: text('status').notNull().default('pending'),
    resolvedAt: timestamp('resolved_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('document_edit_document_idx').on(table.documentId),
    index('document_edit_version_idx').on(table.versionId),
    index('document_edit_thread_idx').on(table.chatThreadId),
    check(
      'document_edit_status_check',
      sql`${table.status} in ('pending', 'accepted', 'rejected')`,
    ),
  ],
)
