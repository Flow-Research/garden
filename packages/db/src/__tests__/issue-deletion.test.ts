import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../schema/index.js'
import { startTestDb, type TestDb } from '../testing/container.js'

describe('issue deletion (integration)', () => {
  let testDb: TestDb
  const userId = randomUUID()
  const workspaceId = randomUUID()

  beforeAll(async () => {
    testDb = await startTestDb()
    await testDb.db.insert(schema.user).values({
      id: userId,
      email: `${userId}@example.com`,
      name: 'Issue owner',
    })
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Issue deletion workspace',
      slug: `issue-deletion-${workspaceId}`,
    })
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it.each([
    { number: 1, comments: true, children: false },
    { number: 2, comments: false, children: true },
    { number: 3, comments: true, children: true },
  ])(
    'deletes an issue with comments=$comments and children=$children',
    async ({ number, comments, children }) => {
      const issueId = randomUUID()
      const childId = randomUUID()
      const commentId = randomUUID()
      const unrelatedId = randomUUID()
      await testDb.db.insert(schema.issue).values([
        {
          id: issueId,
          workspaceId,
          number,
          title: 'Issue to delete',
          createdBy: userId,
        },
        {
          id: unrelatedId,
          workspaceId,
          number: number + 10,
          title: 'Unrelated issue',
          createdBy: userId,
        },
      ])
      if (comments) {
        await testDb.db.insert(schema.issueComment).values({
          id: commentId,
          issueId,
          authorType: 'user',
          authorId: userId,
          body: 'Comment on the deleted issue',
        })
      }
      if (children) {
        await testDb.db.insert(schema.issue).values({
          id: childId,
          workspaceId,
          number: number + 20,
          title: 'Surviving child',
          parentId: issueId,
          createdBy: userId,
        })
        await testDb.db.insert(schema.issueComment).values({
          id: randomUUID(),
          issueId: childId,
          authorType: 'user',
          authorId: userId,
          body: 'Keep the child comment',
        })
      }

      await testDb.db.delete(schema.issue).where(eq(schema.issue.id, issueId))

      expect(
        await testDb.db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.id, issueId)),
      ).toHaveLength(0)
      expect(
        await testDb.db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.issueId, issueId)),
      ).toHaveLength(0)
      expect(
        await testDb.db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.id, unrelatedId)),
      ).toHaveLength(1)
      if (children) {
        const child = await testDb.db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.id, childId))
        expect(child).toHaveLength(1)
        expect(child[0]?.parentId).toBeNull()
        expect(
          await testDb.db
            .select()
            .from(schema.issueComment)
            .where(eq(schema.issueComment.issueId, childId)),
        ).toHaveLength(1)
      }
    },
  )
})
