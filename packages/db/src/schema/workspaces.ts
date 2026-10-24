import { sql } from 'drizzle-orm'
import {
  check,
  index,
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
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
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
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role').notNull().default('member'),
    githubUserId: text('github_user_id'),
    githubLogin: text('github_login'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('member_user_id_idx').on(table.userId),
    uniqueIndex('member_organization_user_unique').on(
      table.organizationId,
      table.userId,
    ),
    uniqueIndex('member_organization_github_user_unique')
      .on(table.organizationId, table.githubUserId)
      .where(sql`${table.githubUserId} is not null`),
    check(
      'member_role_check',
      sql`${table.role} in ('owner', 'admin', 'member')`,
    ),
    // Linked and not_linked are explicit: never store a lone id or login.
    check(
      'member_github_identity_pair_check',
      sql`(${table.githubUserId} is null) = (${table.githubLogin} is null)`,
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
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .default(sql`now()`),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    index('invitation_organization_id_idx').on(table.organizationId),
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
