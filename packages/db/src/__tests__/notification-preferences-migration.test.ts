import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import * as schema from '../schema/index.js'
import {
  MIGRATIONS_DIR,
  startTestDb,
  type TestDb,
} from '../testing/container.js'

describe('notification preferences migration', () => {
  let testDb: TestDb | undefined
  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('gives existing and new members the all-enabled default', async () => {
    testDb = await startTestDb({ migrationsUpTo: 71 })
    const workspaceId = randomUUID()
    const existingId = randomUUID()
    const newId = randomUUID()
    await testDb.db
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Migration proof', slug: workspaceId })
    await testDb.db.insert(schema.user).values([
      { id: existingId, name: 'Existing', email: `${existingId}@example.com` },
      { id: newId, name: 'New', email: `${newId}@example.com` },
    ])
    // The column does not exist yet, so write the pre-migration row shape.
    await testDb.pool.query(
      'insert into member (organization_id, user_id, role) values ($1, $2, $3)',
      [workspaceId, existingId, 'member'],
    )
    await migrate(testDb.db, { migrationsFolder: MIGRATIONS_DIR })
    await testDb.db
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId: newId, role: 'member' })
    const rows = await testDb.db.select().from(schema.member)
    expect(rows.map((row) => row.notificationPreferences)).toEqual([{}, {}])
  })
})
