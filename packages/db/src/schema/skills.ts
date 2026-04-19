import { sql } from 'drizzle-orm'
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { agent } from './agents.js'
import { user } from './users.js'
import { workspace } from './workspaces.js'

export const skill = pgTable(
  'skill',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    frontmatter: text('frontmatter'),
    body: text('body'),
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
    .references(() => skill.id),
  frontmatter: text('frontmatter'),
  body: text('body'),
  authorId: uuid('author_id').references(() => user.id),
  createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
})

export const skillFile = pgTable('skill_file', {
  id: uuid('id').primaryKey(),
  skillId: uuid('skill_id')
    .notNull()
    .references(() => skill.id),
  path: text('path').notNull(),
  contentHash: text('content_hash'),
  r2Key: text('r2_key'),
})

export const agentSkill = pgTable(
  'agent_skill',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skill.id),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.skillId] })],
)
