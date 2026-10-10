// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import * as schema from '@garden/db/schema'
import { reserveXBudget } from './x-budget'

const client = new PGlite()
const db = drizzle(client, { schema })
const first = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
beforeAll(async () => {
  for (const migration of readMigrationFiles({
    migrationsFolder: '../../packages/db/drizzle',
  })) {
    for (const statement of migration.sql) await client.exec(statement)
  }
  await db.insert(schema.user).values([
    { id: first, email: 'first@test.local' },
    { id: second, email: 'second@test.local' },
  ])
})
afterAll(async () => {
  await client.close()
})

describe('X budget PostgreSQL reservation', () => {
  it('accepts only the reservations that fit when calls overlap', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserveXBudget(db, first, 30000, 100000, '2026-10-10'),
      ),
    )
    const outcomes = results.map((result) => result.unwrap())
    expect(
      outcomes.filter((outcome) => outcome.kind === 'reserved'),
    ).toHaveLength(3)
    expect(
      outcomes.filter((outcome) => outcome.kind === 'exhausted'),
    ).toHaveLength(17)
    const rows = await db.select().from(schema.xResearchDailyUsage)
    expect(rows).toMatchObject([{ userId: first, reservedMicroUsd: 90000 }])
  })
  it('isolates members and UTC days while retaining earlier reservations', async () => {
    expect(
      (await reserveXBudget(db, second, 30000, 100000, '2026-10-10')).unwrap()
        .kind,
    ).toBe('reserved')
    expect(
      (await reserveXBudget(db, first, 30000, 100000, '2026-10-11')).unwrap()
        .kind,
    ).toBe('reserved')
    expect(
      (await reserveXBudget(db, first, 20000, 100000, '2026-10-10')).unwrap()
        .kind,
    ).toBe('exhausted')
  })
  it('rejects calls larger than the cap or invalid integer amounts', async () => {
    for (const amount of [100001, 0, -1, 0.5, NaN]) {
      expect(
        (await reserveXBudget(db, first, amount, 100000, '2026-10-12')).unwrap()
          .kind,
      ).toBe('exhausted')
    }
  })
})
