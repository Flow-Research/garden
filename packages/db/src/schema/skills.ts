import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'
import { organization } from './workspaces.js'

export const skill = pgTable(
  'skill',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    frontmatter: text('frontmatter'),
    body: text('body'),
    sourceType: text('source_type').notNull().default('manual'),
    sourceUrl: text('source_url'),
    bundleHash: text('bundle_hash'),
    authorId: uuid('author_id').references(() => user.id),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    uniqueIndex('skill_workspace_slug_unique').on(
      table.workspaceId,
      table.slug,
    ),
  ],
)

export const skillVersion = pgTable('skill_version', {
  id: uuid('id').primaryKey(),
  skillId: uuid('skill_id')
    .notNull()
    .references(() => skill.id, { onDelete: 'cascade' }),
  frontmatter: text('frontmatter'),
  body: text('body'),
  authorId: uuid('author_id').references(() => user.id),
  createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
})

export const skillFile = pgTable('skill_file', {
  id: uuid('id').primaryKey(),
  skillId: uuid('skill_id')
    .notNull()
    .references(() => skill.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  contentHash: text('content_hash'),
  r2Key: text('r2_key'),
})

export const skillAssignment = pgTable(
  'skill_assignment',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind')
      .$type<'workspace_chat' | 'agent'>()
      .notNull(),
    targetId: uuid('target_id').notNull(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skill.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.targetKind,
        table.targetId,
        table.skillId,
      ],
    }),
    index('skill_assignment_target_idx').on(
      table.workspaceId,
      table.targetKind,
      table.targetId,
    ),
    index('skill_assignment_skill_idx').on(table.skillId),
    check(
      'skill_assignment_target_kind_check',
      sql`${table.targetKind} in ('workspace_chat', 'agent')`,
    ),
  ],
)
