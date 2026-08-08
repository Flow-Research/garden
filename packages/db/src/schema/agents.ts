import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'
import { organization } from './workspaces.js'

// Data-driven agent personas. The `agent` row carries the
// personality (name, role, persona, instructions, capabilities, runtime
// config, permissions, icon); the runtime is generic — one Think class
// drives every row. New specialised agents (e.g. Finance) are just new rows.
//
// `host_name` is now the agent runtime identifier. New rows use the agent UUID,
// so each agent identity owns its own Durable Object.
export const agent = pgTable(
  'agent',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => user.id),
    name: text('name').notNull(),
    roleTitle: text('role_title'),
    icon: text('icon'),
    capabilities: text('capabilities'),
    instructions: text('instructions'),
    persona: text('persona'),
    runtimeConfig: jsonb('runtime_config'),
    permissions: jsonb('permissions'),
    adapterType: text('adapter_type').notNull().default('workspace-agent'),
    reportsTo: uuid('reports_to').references((): AnyPgColumn => agent.id),
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status').notNull().default('active'),
    hostName: text('host_name'),
    runTimeoutSec: integer('run_timeout_sec').notNull().default(7200),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('agent_workspace_owner_idx').on(table.workspaceId, table.ownerUserId),
    index('agent_workspace_reports_to_idx').on(
      table.workspaceId,
      table.reportsTo,
    ),
    uniqueIndex('agent_default_idx')
      .on(table.workspaceId)
      .where(sql`${table.isDefault} = true`),
    check(
      'agent_status_check',
      sql`${table.status} in ('active', 'pending_approval', 'archived')`,
    ),
  ],
)
