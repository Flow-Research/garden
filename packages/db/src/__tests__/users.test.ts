import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { user } from '../schema/users.js'
import { startTestDb, type TestDb } from '../testing/container.js'

describe('users (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('inserts a user and reads it back', async () => {
    const inserted = await testDb.db
      .insert(user)
      .values({
        email: 'jane@example.com',
        name: 'Jane Doe',
      })
      .returning()

    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.email).toBe('jane@example.com')
    expect(inserted[0]?.name).toBe('Jane Doe')
    expect(inserted[0]?.emailVerified).toBe(false)
    expect(inserted[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )

    const fetched = await testDb.db
      .select()
      .from(user)
      .where(eq(user.email, 'jane@example.com'))

    expect(fetched).toHaveLength(1)
    expect(fetched[0]?.id).toBe(inserted[0]?.id)
  })

  it('rejects duplicate email (unique constraint)', async () => {
    await testDb.db
      .insert(user)
      .values({ email: 'dupe@example.com', name: 'first' })

    const insertDupe = testDb.db
      .insert(user)
      .values({ email: 'dupe@example.com', name: 'second' })

    await expect(insertDupe).rejects.toThrow()
  })
})
