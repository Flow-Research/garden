import { sql } from 'drizzle-orm'
import {
  index,
  pgTable,
  foreignKey,
  check,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { member, organization } from './workspaces.js'

export const departmentRoleValues = [
  'viewer',
  'member',
  'lead',
  'admin',
] as const

export const department = pgTable(
  'department',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    archivedAt: timestamp('archived_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('department_workspace_slug_unique').on(
      table.workspaceId,
      table.slug,
    ),
    uniqueIndex('department_workspace_id_unique').on(
      table.workspaceId,
      table.id,
    ),
    index('department_workspace_archive_idx').on(
      table.workspaceId,
      table.archivedAt,
    ),
  ],
)

export const departmentMember = pgTable(
  'department_member',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    memberId: uuid('member_id').notNull(),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: 'department_member_department_workspace_fk',
      columns: [table.workspaceId, table.departmentId],
      foreignColumns: [department.workspaceId, department.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'department_member_member_workspace_fk',
      columns: [table.workspaceId, table.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('cascade'),
    uniqueIndex('department_member_workspace_department_member_unique').on(
      table.workspaceId,
      table.departmentId,
      table.memberId,
    ),
    index('department_member_workspace_member_idx').on(
      table.workspaceId,
      table.memberId,
    ),
    index('department_member_workspace_department_idx').on(
      table.workspaceId,
      table.departmentId,
    ),
    check(
      'department_member_role_check',
      sql`${table.role} in ('viewer', 'member', 'lead', 'admin')`,
    ),
  ],
)
