import { sql } from 'drizzle-orm'
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'

export const organization = pgTable(
  'organization',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    metadata: text('metadata'),
    description: text('description'),
    context: text('context'),
    issuePrefix: text('issue_prefix').notNull().default('ISS'),
    settings: jsonb('settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    plan: text('plan').default('free'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    check(
      'organization_issue_prefix_format',
      sql`${table.issuePrefix} ~ '^[A-Z0-9]{2,8}$'`,
    ),
  ],
)

export const member = pgTable(
  'member',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    uniqueIndex('member_organization_user_unique').on(
      table.organizationId,
      table.userId,
    ),
    uniqueIndex('member_organization_id_unique').on(
      table.organizationId,
      table.id,
    ),
    check(
      'member_role_check',
      sql`${table.role} in ('owner', 'admin', 'member')`,
    ),
  ],
)

export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    check(
      'invitation_role_check',
      sql`${table.role} in ('owner', 'admin', 'member')`,
    ),
    check(
      'invitation_status_check',
      sql`${table.status} in ('pending', 'accepted', 'rejected', 'canceled')`,
    ),
  ],
)
