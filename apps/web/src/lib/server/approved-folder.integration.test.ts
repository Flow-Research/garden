// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import { getOrCreateApprovedFolder } from './brain-folders'

let db: TestDb
beforeAll(async () => {
  db = await startTestDb()
}, 120000)
afterAll(async () => {
  await db?.cleanup()
})

it.each(['Research', 'W'.repeat(51)])(
  'reuses one shared folder across concurrent saves in %s',
  async (name) => {
    const userId = randomUUID()
    const workspaceId = randomUUID()
    await db.db
      .insert(schema.user)
      .values({ id: userId, email: `${userId}@example.test` })
    await db.db
      .insert(schema.organization)
      .values({ id: workspaceId, name, slug: workspaceId })
    const expectedName =
      name.length <= 50 ? name : 'Approved workspace documents'
    await db.db.insert(schema.brainFolder).values({
      workspaceId,
      name: expectedName,
      privacy: 'private',
      createdBy: userId,
    })
    const saved = await Promise.all(
      Array.from({ length: 8 }, () =>
        getOrCreateApprovedFolder(db.db, workspaceId, userId),
      ),
    )
    expect(new Set(saved.map((folder) => folder.id)).size).toBe(1)
    const folders = await db.db
      .select()
      .from(schema.brainFolder)
      .where(eq(schema.brainFolder.workspaceId, workspaceId))
    expect(folders.filter((folder) => folder.privacy === 'shared')).toEqual([
      expect.objectContaining({ id: saved[0]?.id, name: expectedName }),
    ])
  },
)
