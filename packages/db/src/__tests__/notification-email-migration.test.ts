import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import * as schema from '../schema/index.js'
import {
  MIGRATIONS_DIR,
  startTestDb,
  type TestDb,
} from '../testing/container.js'

describe('notification email migration', () => {
  let testDb: TestDb | undefined
  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('skips historical items while queueing new items after migration', async () => {
    testDb = await startTestDb({ migrationsUpTo: 66 })
    const workspaceId = randomUUID()
    const recipientId = randomUUID()
    await testDb.db
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Migration proof', slug: workspaceId })
    await testDb.db.insert(schema.user).values({
      id: recipientId,
      name: 'Recipient',
      email: `${recipientId}@example.com`,
    })
    // Use the old data shape before the new column exists. The checked-in
    // Drizzle migration owns all schema changes, not the test fixture.
    await testDb.pool.query(
      'insert into inbox_item (id, workspace_id, recipient_type, recipient_id, item_key, type, title, activity_at) values ($1, $2, $3, $4, $5, $6, $7, now())',
      [
        randomUUID(),
        workspaceId,
        'member',
        recipientId,
        'old',
        'mentioned',
        'Old mention',
      ],
    )
    await migrate(testDb.db, { migrationsFolder: MIGRATIONS_DIR })
    await testDb.db.insert(schema.inboxItem).values({
      id: randomUUID(),
      workspaceId,
      recipientType: 'member',
      recipientId,
      itemKey: 'new',
      type: 'mentioned',
      title: 'New mention',
      activityAt: new Date(),
    })
    const rows = await testDb.db.select().from(schema.inboxItem)
    expect(rows.find((row) => row.itemKey === 'old')?.emailDelivery).toEqual({
      kind: 'skipped',
      reason: 'historical',
    })
    expect(rows.find((row) => row.itemKey === 'new')?.emailDelivery).toEqual({
      kind: 'pending',
    })
  })
})
