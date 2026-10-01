import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'
import { organization } from './workspaces.js'

export const brainRetrieval = pgTable(
  'brain_retrieval',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    actorUserId: uuid('actor_user_id').references(() => user.id),
    agentId: text('agent_id'),
    surface: text('surface', {
      enum: ['chat', 'issue_run', 'automation_run', 'upload', 'other'],
    }).notNull(),
    source: text('source', { enum: ['injection', 'tool'] }).notNull(),
    query: text('query').notNull(),
    scope: jsonb('scope').$type<{
      teamIds: readonly string[]
      userId: string | null
    }>(),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('brain_retrieval_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    check(
      'brain_retrieval_surface_check',
      sql`${table.surface} in ('chat', 'issue_run', 'automation_run', 'upload', 'other')`,
    ),
    check(
      'brain_retrieval_source_check',
      sql`${table.source} in ('injection', 'tool')`,
    ),
  ],
)

export const brainRetrievalHit = pgTable(
  'brain_retrieval_hit',
  {
    retrievalId: uuid('retrieval_id')
      .notNull()
      .references(() => brainRetrieval.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    rank: integer('rank').notNull(),
    score: doublePrecision('score').notNull(),
    used: boolean('used').notNull().default(false),
    usedAt: timestamp('used_at', { mode: 'date' }),
  },
  (table) => [
    primaryKey({ columns: [table.retrievalId, table.itemId] }),
    index('brain_retrieval_hit_item_idx').on(table.itemId),
    check('brain_retrieval_hit_rank_check', sql`${table.rank} >= 0`),
  ],
)

export const brainWriteProposal = pgTable(
  'brain_write_proposal',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id),
    runId: text('run_id').notNull(),
    claimHash: text('claim_hash').notNull(),
    claim: text('claim').notNull(),
    kind: text('kind').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    scope: jsonb('scope')
      .$type<
        | { kind: 'org' }
        | { kind: 'team'; teamId: string }
        | { kind: 'user'; userId: string }
      >()
      .notNull(),
    evidence: jsonb('evidence').$type<readonly string[]>(),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected'],
    })
      .notNull()
      .default('pending'),
    decidedBy: uuid('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  },
  (table) => [
    index('brain_write_proposal_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    index('brain_write_proposal_run_claim_idx').on(
      table.runId,
      table.claimHash,
    ),
    check(
      'brain_write_proposal_status_check',
      sql`${table.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      'brain_write_proposal_confidence_check',
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
)
