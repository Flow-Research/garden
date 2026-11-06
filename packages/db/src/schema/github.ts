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

export const githubWebhookDeliveryStatusValues = ['applied', 'stale'] as const

/**
 * GitHub App webhook delivery ledger, one row per accepted `X-GitHub-Delivery`.
 *
 * Why: HMAC proves a delivery came from GitHub, not that it is new or current.
 * GitHub redeliveries reuse the delivery id, and deliveries can arrive out of
 * order, so before this table a retried or late `issues.edited` could rewrite
 * newer Garden state. The unique `(binding_id, delivery_id)` turns a
 * redelivery into a no-op per binding; one delivery fans out to every Garden
 * workspace linked to the same GitHub App installation, so the id alone is not
 * unique, and `order_marker` (the GitHub `updated_at` of the issue or comment,
 * in ms) per `order_scope` lets the webhook reject a delivery older than one
 * already applied. A separate ledger beats a marker column on
 * `issue_source_binding` because comments need their own order streams and
 * replay detection needs every delivery id, not only the latest.
 * Rows cascade with their binding.
 */
export const githubWebhookDelivery = pgTable(
  'github_webhook_delivery',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    deliveryId: text('delivery_id').notNull(),
    bindingId: uuid('binding_id')
      .notNull()
      .references(() => issueSourceBinding.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    action: text('action').notNull(),
    orderScope: text('order_scope').notNull(),
    orderMarker: bigint('order_marker', { mode: 'number' }).notNull(),
    status: text('status').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('github_webhook_delivery_binding_delivery_unique').on(
      table.bindingId,
      table.deliveryId,
    ),
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
