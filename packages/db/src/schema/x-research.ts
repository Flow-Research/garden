import { sql } from 'drizzle-orm'
import {
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './users.js'

// Global personal budget: switching workspaces or connections cannot reset it.
export const xResearchDailyUsage = pgTable(
  'x_research_daily_usage',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    reservedMicroUsd: integer('reserved_micro_usd').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.day] }),
    check('x_research_usage_nonnegative', sql`${table.reservedMicroUsd} >= 0`),
  ],
)
