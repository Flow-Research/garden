import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { agent } from './agents.js'
import { user } from './users.js'
import { organization } from './workspaces.js'

/**
 * Team — a named group inside a workspace. `owner_user_id` is Team ownership,
 * not a workspace role: it must reference a workspace user who is also a
 * current Team member (enforced by the write service). Agents can be members
 * but never owners.
 *
 * The unique `(id, workspace_id)` key exists so child tables can use a
 * workspace-safe composite foreign key that makes cross-workspace child rows
 * impossible at the database level.
 */
export const team = pgTable(
  'team',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => user.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('team_workspace_name_unique').on(
      table.workspaceId,
      sql`lower(${table.name})`,
    ),
    // A table-level UNIQUE constraint (not a bare unique index) so Postgres has
    // the referenced key available when the composite child FKs are created.
    unique('team_id_workspace_unique').on(table.id, table.workspaceId),
    index('team_workspace_updated_idx').on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
)

/**
 * Team membership — exactly one of `user_id` or `agent_id` is set. The
 * composite `(team_id, workspace_id)` foreign key keeps membership rows in
 * the same workspace as their Team; the write service additionally verifies
 * the selected user/agent belongs to that workspace.
 */
export const teamMember = pgTable(
  'team_member',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    teamId: uuid('team_id').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agent.id, {
      onDelete: 'cascade',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: 'team_member_team_workspace_fk',
      columns: [table.teamId, table.workspaceId],
      foreignColumns: [team.id, team.workspaceId],
    }).onDelete('cascade'),
    uniqueIndex('team_member_team_user_unique').on(table.teamId, table.userId),
    uniqueIndex('team_member_team_agent_unique').on(
      table.teamId,
      table.agentId,
    ),
    index('team_member_workspace_team_idx').on(
      table.workspaceId,
      table.teamId,
    ),
    check(
      'team_member_identity_check',
      sql`(${table.userId} is not null) <> (${table.agentId} is not null)`,
    ),
  ],
)
