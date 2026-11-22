import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization } from './workspaces.js'
import { user } from './users.js'

/** External host delivery state stays separate from Garden-managed issue Workflows. */
export const executionHost = pgTable(
  'execution_host',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => user.id),
    enrollment: jsonb('enrollment').notNull().$type<Record<string, unknown>>(),
    keyGeneration: integer('key_generation').notNull(),
    status: text('status').notNull().default('enrolled'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('execution_host_workspace_identity').on(table.id, table.workspaceId),
    index('execution_host_workspace_idx').on(table.workspaceId),
    check(
      'execution_host_status_check',
      sql`${table.status} in ('enrolled','revoked')`,
    ),
    check(
      'execution_host_key_generation_positive',
      sql`${table.keyGeneration} > 0`,
    ),
  ],
)

/** Every signed request consumes its nonce in the same transaction as its delivery effect. */
export const executionHostNonce = pgTable(
  'execution_host_nonce',
  {
    hostId: uuid('host_id')
      .notNull()
      .references(() => executionHost.id, { onDelete: 'cascade' }),
    keyGeneration: integer('key_generation').notNull(),
    nonce: uuid('nonce').notNull(),
    signedAt: timestamp('signed_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.hostId, table.keyGeneration, table.nonce] }),
    index('execution_host_nonce_age_idx').on(table.signedAt),
  ],
)

/** Immutable inputs and one acknowledgment bind retries to one host run. */
export const executionHostLaunch = pgTable(
  'execution_host_launch',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    launchId: uuid('launch_id').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    hostId: uuid('host_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => user.id),
    requestDigest: text('request_digest').notNull(),
    launch: jsonb('launch').notNull().$type<Record<string, unknown>>(),
    status: text('status').notNull().default('pending'),
    hostRunId: uuid('host_run_id'),
    lastEventSequence: bigint('last_event_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    lastEventAt: timestamp('last_event_at', {
      withTimezone: true,
      mode: 'date',
    }),
    declineId: uuid('decline_id'),
    declineReason: text('decline_reason'),
    cancelCommandId: uuid('cancel_command_id'),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      withTimezone: true,
      mode: 'date',
    }),
    cancelBeforeDispatch: boolean('cancel_before_dispatch')
      .notNull()
      .default(false),
    terminalAt: timestamp('terminal_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.hostId, table.workspaceId],
      foreignColumns: [executionHost.id, executionHost.workspaceId],
    }).onDelete('cascade'),
    uniqueIndex('execution_host_launch_workspace_identity').on(
      table.workspaceId,
      table.launchId,
    ),
    uniqueIndex('execution_host_launch_run_identity').on(
      table.hostId,
      table.hostRunId,
    ),
    index('execution_host_launch_delivery_idx').on(
      table.hostId,
      table.status,
      table.createdAt,
    ),
    check(
      'execution_host_launch_status_check',
      sql`${table.status} in ('pending','acknowledged','revoked')`,
    ),
    check(
      'execution_host_launch_digest_check',
      sql`${table.requestDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'execution_host_launch_sequence_nonnegative',
      sql`${table.lastEventSequence} >= 0`,
    ),
  ],
)

/** Host sequence is the replay cursor. Event payloads contain fixed control fields only. */
export const executionHostEvent = pgTable(
  'execution_host_event',
  {
    launchRecordId: uuid('launch_record_id')
      .notNull()
      .references(() => executionHostLaunch.id, { onDelete: 'cascade' }),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    digest: text('digest').notNull(),
    event: jsonb('event').notNull().$type<Record<string, unknown>>(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.launchRecordId, table.sequence] }),
    check('execution_host_event_sequence_positive', sql`${table.sequence} > 0`),
  ],
)

/**
 * A host intervention asks the pilot operator to resume or stop one acknowledged run.
 * The stored answer bytes are fixed at answer time, so every redelivery carries one identity.
 */
export const executionHostIntervention = pgTable(
  'execution_host_intervention',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    interventionId: uuid('intervention_id').notNull(),
    launchRecordId: uuid('launch_record_id')
      .notNull()
      .references(() => executionHostLaunch.id, { onDelete: 'cascade' }),
    hostId: uuid('host_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    digest: text('digest').notNull(),
    intervention: jsonb('intervention')
      .notNull()
      .$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    answerId: uuid('answer_id'),
    answer: jsonb('answer').$type<Record<string, unknown>>(),
    answeredBy: uuid('answered_by').references(() => user.id),
    answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    foreignKey({
      columns: [table.hostId, table.workspaceId],
      foreignColumns: [executionHost.id, executionHost.workspaceId],
    }).onDelete('cascade'),
    uniqueIndex('execution_host_intervention_identity').on(
      table.hostId,
      table.interventionId,
    ),
    uniqueIndex('execution_host_intervention_answer_identity').on(
      table.answerId,
    ),
    index('execution_host_intervention_launch_idx').on(table.launchRecordId),
    check(
      'execution_host_intervention_digest_check',
      sql`${table.digest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'execution_host_intervention_answer_complete',
      sql`(${table.answerId} is null) = (${table.answer} is null) and (${table.answerId} is null) = (${table.answeredBy} is null) and (${table.answerId} is null) = (${table.answeredAt} is null)`,
    ),
  ],
)

/** One pilot operator retains one execution slot across all enrolled machines until confirmed termination. */
export const executionHostCapacity = pgTable(
  'execution_host_capacity',
  {
    operatorId: uuid('operator_id')
      .primaryKey()
      .references(() => user.id),
    launchRecordId: uuid('launch_record_id').references(
      () => executionHostLaunch.id,
    ),
    reservedAt: timestamp('reserved_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('execution_host_capacity_launch_unique').on(
      table.launchRecordId,
    ),
  ],
)
