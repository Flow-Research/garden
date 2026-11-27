import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, startTestDb, type TestDb } from '../testing/index.js'

/**
 * Migration 0058 turns integer issue positions into fractional-indexing keys.
 * It must keep every workspace's order, give each issue a valid and distinct
 * key, and use byte-order collation so Postgres sorts keys like JavaScript.
 */
describe('issue position migration 0058 (integration)', () => {
  let testDb: TestDb
  const workspaceA = randomUUID()
  const workspaceB = randomUUID()
  const workspaceLarge = randomUUID()
  const userId = randomUUID()
  // Current order in workspace A: by position, then created_at, then id.
  const orderA: string[] = []

  async function insertIssue(
    workspaceId: string,
    number: number,
    position: number,
    createdAt: string,
  ) {
    const id = randomUUID()
    await testDb.pool.query(
      `INSERT INTO "issue" (id, workspace_id, number, title, created_by, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, workspaceId, number, `Issue ${number}`, userId, position, createdAt],
    )
    return id
  }

  beforeAll(async () => {
    testDb = await startTestDb({ migrationsUpTo: 57 })
    await testDb.pool.query(`INSERT INTO "user" (id, email) VALUES ($1, $2)`, [
      userId,
      'owner@garden.test',
    ])
    for (const [id, slug] of [
      [workspaceA, 'a'],
      [workspaceB, 'b'],
      [workspaceLarge, 'large'],
    ]) {
      await testDb.pool.query(
        `INSERT INTO "organization" (id, name, slug) VALUES ($1, $2, $3)`,
        [id, slug, slug],
      )
    }

    // Ties, negatives and gaps, inserted out of order.
    const third = await insertIssue(workspaceA, 1, 3, '2026-01-03T00:00:00Z')
    const fifth = await insertIssue(workspaceA, 2, 5, '2026-01-01T00:00:00Z')
    const first = await insertIssue(workspaceA, 3, -2, '2026-01-05T00:00:00Z')
    const tieLater = await insertIssue(workspaceA, 4, 0, '2026-01-04T00:00:00Z')
    const tieEarlier = await insertIssue(
      workspaceA,
      5,
      0,
      '2026-01-02T00:00:00Z',
    )
    orderA.push(first, tieEarlier, tieLater, third, fifth)

    await insertIssue(workspaceB, 1, 7, '2026-01-01T00:00:00Z')

    // Enough issues to cross from one-digit to two-digit keys.
    const values: string[] = []
    const params: unknown[] = []
    for (let index = 0; index < 4000; index++) {
      const base = params.length
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
      )
      params.push(
        randomUUID(),
        workspaceLarge,
        index + 1,
        `Issue ${index}`,
        userId,
        index,
      )
    }
    await testDb.pool.query(
      `INSERT INTO "issue" (id, workspace_id, number, title, created_by, position)
       VALUES ${values.join(', ')}`,
      params,
    )

    const pool = new Pool({ connectionString: testDb.databaseUrl })
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR })
    } finally {
      await pool.end()
    }
  }, 180_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function keysOf(workspaceId: string, orderBy = 'position') {
    const { rows } = await testDb.pool.query<{ id: string; position: string }>(
      `SELECT id, position FROM "issue" WHERE workspace_id = $1 ORDER BY ${orderBy}`,
      [workspaceId],
    )
    return rows
  }

  it("keeps each workspace's order, ties broken by creation time", async () => {
    const rows = await keysOf(workspaceA)
    expect(rows.map((row) => row.id)).toEqual(orderA)
    expect(rows.map((row) => row.position)).toEqual([
      'a0',
      'a1',
      'a2',
      'a3',
      'a4',
    ])
    const [only] = await keysOf(workspaceB)
    expect(only?.position).toBe('a0')
  })

  it("matches the library's own key sequence across key widths", async () => {
    const rows = await keysOf(workspaceLarge, 'number')
    expect(rows.map((row) => row.position)).toEqual(
      generateNKeysBetween(null, null, 4000),
    )
  })

  it('gives keys the library accepts, and sorts them like JavaScript', async () => {
    const rows = await keysOf(workspaceLarge)
    const keys = rows.map((row) => row.position)
    expect(keys).toEqual([...keys].sort())
    // Throws if either key is invalid or they are out of order.
    expect(() => generateKeyBetween(keys[60], keys[61])).not.toThrow()
    expect(() => generateKeyBetween(keys[3999], null)).not.toThrow()
    // A key below all others starts with an upper-case head, which must
    // still sort first under the column's collation.
    const below = generateKeyBetween(null, keys[0])
    const { rows: sorted } = await testDb.pool.query<{ k: string }>(
      `SELECT k FROM unnest($1::text[]) AS k ORDER BY k COLLATE "C"`,
      [[keys[0], below]],
    )
    expect(sorted.map((row) => row.k)).toEqual([below, keys[0]])
  })

  it('makes position a non-null text column with byte-order collation', async () => {
    const { rows } = await testDb.pool.query<{
      data_type: string
      is_nullable: string
      collation_name: string | null
      column_default: string | null
    }>(
      `SELECT data_type, is_nullable, collation_name, column_default
       FROM information_schema.columns
       WHERE table_name = 'issue' AND column_name = 'position'`,
    )
    expect(rows[0]).toMatchObject({
      data_type: 'text',
      is_nullable: 'NO',
      collation_name: 'C',
    })
    expect(rows[0]?.column_default).toContain("'a0'")
  })
})
