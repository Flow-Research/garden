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

export const capability = pgTable(
  'capability',
  {
    id: uuid('id').primaryKey(),
    connectorType: text('connector_type').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    inputSchema: jsonb('input_schema'),
    outputSchema: jsonb('output_schema'),
    schemaHash: text('schema_hash').notNull().default(''),
    requiredScopes: text('required_scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    riskClass: text('risk_class').notNull().default('read'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('capability_connector_type_name_unique').on(
      table.connectorType,
      table.name,
    ),
    check(
      'capability_risk_class_check',
      sql`${table.riskClass} in ('read', 'write', 'send_external', 'destructive')`,
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
    trustLevel: text('trust_level').notNull().default('ask'),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp('granted_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { mode: 'date' }),
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
    argsJson: jsonb('args_json'),
    toolCallId: text('tool_call_id').notNull().default(''),
    requestedAt: timestamp('requested_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    status: text('status').notNull().default('pending'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { mode: 'date' }),
  },
  (table) => [
    check(
      'permission_request_status_check',
      sql`${table.status} in ('pending', 'approved', 'denied')`,
    ),
  ],
)
