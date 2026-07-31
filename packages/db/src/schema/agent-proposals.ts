import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { agent } from './agents.js'
import { chatThread } from './chat.js'
import { issue } from './issues.js'

/**
 * Garden-owned approval ledger for agents proposed by the default agent.
 * Proposal rows previously shared permission_request with connector execution
 * approvals; keeping only proposal identity and lifecycle fields lets connector
 * policy move out of Garden without coupling the two domains.
 */
export const agentProposalRequest = pgTable(
  'agent_proposal_request',
  {
    id: uuid('id').primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    pendingAgentId: uuid('pending_agent_id')
      .notNull()
      .references(() => agent.id),
    issueId: uuid('issue_id').references(() => issue.id, {
      onDelete: 'set null',
    }),
    threadId: uuid('thread_id').references(() => chatThread.id, {
      onDelete: 'set null',
    }),
    argsJson: jsonb('args_json'),
    requestedAt: timestamp('requested_at', { mode: 'date' })
      .notNull()
      .default(sql`now()`),
    status: text('status').notNull().default('pending'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { mode: 'date' }),
  },
  (table) => [
    check(
      'agent_proposal_request_status_check',
      sql`${table.status} in ('pending', 'approved', 'denied')`,
    ),
    index('agent_proposal_request_thread_idx').on(table.threadId),
    index('agent_proposal_request_pending_idx').on(
      table.status,
      table.requestedAt,
    ),
  ],
)
