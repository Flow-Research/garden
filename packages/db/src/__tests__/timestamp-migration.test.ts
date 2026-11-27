import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, startTestDb, type TestDb } from '../testing/index.js'

/**
 * Migration 0050 reads every legacy `timestamp` value as UTC. Its preflight
 * must abort, leaving the columns untouched, whenever that cannot be
 * confirmed, and the conversion must keep UTC values unchanged otherwise.
 */
describe('timestamp migration 0050 (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb({ migrationsUpTo: 49 })
    await testDb.pool.query(
      `INSERT INTO "user" (email, created_at) VALUES ('legacy@garden.test', '2026-01-15 10:00:00')`,
    )
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  /** Runs the remaining migrations in a fresh session with `timeZone`. */
  async function migrateRest(timeZone: string) {
    const pool = new Pool({
      connectionString: testDb.databaseUrl,
      options: `-c timezone=${timeZone}`,
    })
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR })
    } finally {
      await pool.end()
    }
  }

  /** The Postgres error behind drizzle's "Failed query" wrapper. */
  async function migrationFailure(timeZone: string) {
    try {
      await migrateRest(timeZone)
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      return cause instanceof Error ? cause.message : String(error)
    }
    return null
  }

  async function createdAtType() {
    const { rows } = await testDb.pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'user' AND column_name = 'created_at'`,
    )
    return rows[0]?.data_type
  }

  it('aborts when the session time zone is not UTC', async () => {
    expect(await migrationFailure('America/New_York')).toMatch(
      /^Migration 0050 aborted: session TimeZone is "America\/New_York"/,
    )
    expect(await createdAtType()).toBe('timestamp without time zone')
  })

  it('aborts when a database setting overrides the time zone', async () => {
    await testDb.pool.query(
      `ALTER DATABASE test SET timezone = 'Europe/Berlin'`,
    )
    try {
      expect(await migrationFailure('UTC')).toMatch(
        /^Migration 0050 aborted: a role or database sets a non-UTC TimeZone/,
      )
    } finally {
      await testDb.pool.query('ALTER DATABASE test RESET timezone')
    }
    expect(await createdAtType()).toBe('timestamp without time zone')
  })

  it('aborts when a created_at value lies in the future by UTC', async () => {
    await testDb.pool.query(
      `INSERT INTO "user" (email, created_at)
       VALUES ('east@garden.test', (now() AT TIME ZONE 'UTC') + interval '3 hours')`,
    )
    try {
      expect(await migrationFailure('UTC')).toMatch(
        /^Migration 0050 aborted: 1 row\(s\) in user\.created_at are more than an hour in the future/,
      )
    } finally {
      await testDb.pool.query(
        `DELETE FROM "user" WHERE email = 'east@garden.test'`,
      )
    }
    expect(await createdAtType()).toBe('timestamp without time zone')
  })

  it('converts the columns once the invariant holds, keeping UTC values', async () => {
    await migrateRest('UTC')

    expect(await createdAtType()).toBe('timestamp with time zone')
    const { rows } = await testDb.pool.query<{ created_at: string }>(
      `SELECT created_at::text FROM "user" WHERE email = 'legacy@garden.test'`,
    )
    expect(rows[0]?.created_at).toBe('2026-01-15 10:00:00+00')
  })
})
