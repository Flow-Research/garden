import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  name: text('name').notNull().default(''),
  emailVerified: boolean('email_verified').notNull().default(false),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { mode: 'date' }).default(sql`now()`),
  updatedAt: timestamp('updated_at', { mode: 'date' }).default(sql`now()`),
})
