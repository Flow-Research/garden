import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './users.js'

export const session = pgTable('auth_session', {
  id: uuid('id').primaryKey(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  token: text('token').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  activeOrganizationId: uuid('active_organization_id'),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('auth_account', {
  id: uuid('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { mode: 'date' }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    mode: 'date',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
})

export const verification = pgTable('auth_verification', {
  id: uuid('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }),
  updatedAt: timestamp('updated_at', { mode: 'date' }),
})
