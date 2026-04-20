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
import { agent } from './agents.js'
import { user } from './users.js'
import { organization } from './workspaces.js'

export const capability = pgTable(
  'capability',
  {
    id: uuid('id').primaryKey(),
    connectorType: text('connector_type').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    inputSchema: jsonb('input_schema'),
    outputSchema: jsonb('output_schema'),
    riskClass: text('risk_class').default('read'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    check(
      'capability_risk_class_check',
      sql`${table.riskClass} in ('read', 'write', 'send_external', 'destructive')`,
    ),
  ],
)

export const connectorConnection = pgTable(
  'connector_connection',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    connectorType: text('connector_type').notNull(),
    encryptedCredentials: text('encrypted_credentials'),
    scopes: text('scopes').array(),
    status: text('status').default('connected'),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    check(
      'connector_connection_status_check',
      sql`${table.status} in ('connected', 'degraded', 'disconnected')`,
    ),
  ],
)

export const permissionGrant = pgTable(
  'permission_grant',
  {
    id: uuid('id').primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capability.id),
    trustLevel: text('trust_level').default('ask'),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp('granted_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    uniqueIndex('permission_grant_agent_capability_unique').on(
      table.agentId,
      table.capabilityId,
    ),
    check(
      'permission_grant_trust_level_check',
      sql`${table.trustLevel} in ('auto', 'allow', 'ask')`,
    ),
  ],
)

export const permissionRequest = pgTable(
  'permission_request',
  {
    id: uuid('id').primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capability.id),
    context: text('context'),
    issueId: uuid('issue_id'),
    status: text('status').default('pending'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { mode: 'date' }),
  },
  (table) => [
    check(
      'permission_request_status_check',
      sql`${table.status} in ('pending', 'approved', 'dismissed')`,
    ),
  ],
)
