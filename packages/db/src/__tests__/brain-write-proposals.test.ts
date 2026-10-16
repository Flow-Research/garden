import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
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
          claimHash: hash,
          operationKey: `${runId}:${hash}`,
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

    await testDb.db
      .update(schema.brainWriteProposal)
      .set({ status: 'rejected' })
      .where(
        and(
          eq(schema.brainWriteProposal.workspaceId, workspaceId),
          eq(schema.brainWriteProposal.claimHash, claimHash),
        ),
      )
    expect(await insert('run-4')).toHaveLength(1)
    expect(await insert('run-1')).toHaveLength(0)

    const rows = await testDb.db
      .select()
      .from(schema.brainWriteProposal)
      .where(eq(schema.brainWriteProposal.workspaceId, workspaceId))
    expect(rows).toHaveLength(3)
  })

  /**
   * The pending-only claim index stops guarding a claim once its proposal is
   * resolved, so a run replayed after approval or rejection must be stopped by
   * the operation key alone. No other pending row exists here, which isolates
   * operation-key enforcement from the semantic pending index.
   */
  it.each(['approved', 'rejected'] as const)(
    'blocks a same-run retry after the proposal is %s',
    async (status) => {
      const workspaceId = randomUUID()
      await testDb.db.insert(schema.organization).values({
        id: workspaceId,
        name: 'Brain retry workspace',
        slug: `brain-retry-${workspaceId}`,
      })

      const claimHash = 'resolved-claim-hash'
      const insert = (runId: string) =>
        testDb.db
          .insert(schema.brainWriteProposal)
          .values({
            workspaceId,
            runId,
            claimHash,
            operationKey: `${runId}:${claimHash}`,
            claim: 'Use D1 for durable workflow state.',
            kind: 'decision',
            confidence: 0.4,
            scope: { kind: 'org' },
          })
          .onConflictDoNothing()
          .returning({ id: schema.brainWriteProposal.id })

      expect(await insert('run-123')).toHaveLength(1)
      await testDb.db
        .update(schema.brainWriteProposal)
        .set({ status, decidedAt: new Date() })
        .where(eq(schema.brainWriteProposal.workspaceId, workspaceId))

      expect(await insert('run-123')).toHaveLength(0)
      expect(await insert('run-456')).toHaveLength(1)

      const rows = await testDb.db
        .select({
          runId: schema.brainWriteProposal.runId,
          status: schema.brainWriteProposal.status,
        })
        .from(schema.brainWriteProposal)
        .where(eq(schema.brainWriteProposal.workspaceId, workspaceId))
      expect(rows).toHaveLength(2)
      expect(rows).toEqual(
        expect.arrayContaining([
          { runId: 'run-123', status },
          { runId: 'run-456', status: 'pending' },
        ]),
      )
    },
  )
})
