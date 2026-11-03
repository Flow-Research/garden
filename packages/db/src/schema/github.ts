import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization } from './workspaces.js'
import { user } from './users.js'
import { issueSourceBinding } from './issues.js'
import { sqlValueList } from './sql-values.js'

export const githubAppInstallation = pgTable(
  'github_app_installation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    installationId: text('installation_id').notNull(),
    accountLogin: text('account_login').notNull(),
    repositorySelection: text('repository_selection')
      .notNull()
      .default('selected'),
    status: text('status').notNull().default('connected'),
    connectedBy: uuid('connected_by').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('github_app_installation_workspace_unique').on(
      table.workspaceId,
    ),
    check(
      'github_app_installation_status_check',
      sql`${table.status} in ('connected', 'degraded', 'disconnected')`,
    ),
  ],
)

export const githubWebhookDeliveryStatusValues = [
  'applied',
  'duplicate',
  'out_of_order',
  'ignored',
] as const

/**
 * GitHub App webhook delivery ledger (#161 review).
 *
 * Why this exists: HMAC alone does not stop GitHub retries from replaying the
 * same `X-GitHub-Delivery`, or an older edit from overwriting a newer one.
 * Before this table, apply was best-effort compare-and-patch only. After:
 * unique `delivery_id` claims exact retries as duplicates, and
 * `(order_scope, order_marker)` max comparison rejects stale deliveries.
 */
export const githubWebhookDelivery = pgTable(
  'github_webhook_delivery',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    deliveryId: text('delivery_id').notNull(),
    event: text('event').notNull(),
    action: text('action'),
    installationId: text('installation_id'),
    orderScope: text('order_scope').notNull(),
    orderMarker: bigint('order_marker', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('applied'),
    bindingId: uuid('binding_id').references(() => issueSourceBinding.id, {
      onDelete: 'set null',
    }),
    workspaceId: uuid('workspace_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('github_webhook_delivery_id_unique').on(table.deliveryId),
    index('github_webhook_delivery_order_scope_marker_idx').on(
      table.orderScope,
      table.orderMarker,
    ),
    check(
      'github_webhook_delivery_status_check',
      sql`${table.status} in (${sqlValueList(githubWebhookDeliveryStatusValues)})`,
    ),
  ],
)
