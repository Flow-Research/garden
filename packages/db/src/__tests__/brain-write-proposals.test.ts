import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../schema/index.js'
import { startTestDb, type TestDb } from '../testing/container.js'

describe('brain write proposal idempotency (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  /**
   * Exercises PostgreSQL uniqueness rather than an application preflight. This
   * proves concurrent retries and separate runs converge even when both callers
   * pass duplicate checks before either insert commits.
   */
  it('persists one semantic claim across concurrent calls and retries', async () => {
    const workspaceId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Brain idempotency workspace',
      slug: `brain-idempotency-${workspaceId}`,
    })

    const claimHash = 'semantic-claim-hash'
    const insert = (runId: string, hash = claimHash) =>
      testDb.db
        .insert(schema.brainWriteProposal)
        .values({
          workspaceId,
          runId,
          operationKey: `${runId}:${hash}`,
          claimHash: hash,
          claim: 'Use D1 for durable workflow state.',
          kind: 'decision',
          confidence: 0.4,
          scope: { kind: 'org' },
        })
        .onConflictDoNothing()
        .returning({ id: schema.brainWriteProposal.id })

    const concurrent = await Promise.all([
      insert('run-1'),
      insert('run-1'),
      insert('run-2'),
    ])
    expect(concurrent.flat()).toHaveLength(1)
    expect(await insert('run-1')).toHaveLength(0)
    expect(await insert('run-3')).toHaveLength(0)
    expect(await insert('run-3', 'changed-claim-hash')).toHaveLength(1)

    const rows = await testDb.db
      .select()
      .from(schema.brainWriteProposal)
      .where(eq(schema.brainWriteProposal.workspaceId, workspaceId))
    expect(rows).toHaveLength(2)
  })
})
