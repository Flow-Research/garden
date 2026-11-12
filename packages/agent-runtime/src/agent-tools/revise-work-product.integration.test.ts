import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import type * as runtimeDb from '@garden/db/runtime'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { createReviseWorkProductTool } from './revise-work-product'
import type { IssueRunToolContext } from './issue-run-tool-context'

const dbFactory = vi.hoisted(() => ({
  getPooledDb: vi.fn<typeof runtimeDb.getPooledDb>(),
}))

/** Reuses the suite's test DB client so no second pool outlives the container. */
vi.mock('@garden/db/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof runtimeDb>()),
  getPooledDb: dbFactory.getPooledDb,
}))

let testDb: TestDb

/**
 * FLO-150 (run b749d28b): `revise_work_product` failed in garden-dev because
 * the previous_versions SQL bound untyped params inside jsonb_build_object.
 * This drives the real tool against Postgres and revises one work product
 * twice, so the history append is proven on a real database.
 */
describe('revise_work_product (integration)', () => {
  const workspaceId = randomUUID()
  const ownerId = randomUUID()
  const agentId = randomUUID()
  const issueId = randomUUID()
  const runId = randomUUID()
  const workProductId = randomUUID()

  beforeAll(async () => {
    testDb = await startTestDb()
    dbFactory.getPooledDb.mockImplementation(() => testDb.db)
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Revise workspace',
      slug: `revise-${workspaceId}`,
    })
    await testDb.db.insert(schema.user).values({
      id: ownerId,
      name: 'Owner',
      email: `${ownerId}@example.com`,
    })
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId: ownerId,
      name: 'Agent',
      hostName: agentId,
      permissions: { full_access: true },
    })
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId,
      number: 1,
      title: 'Issue',
      status: 'in_progress',
      createdBy: ownerId,
    })
    await testDb.db.insert(schema.issueRun).values({
      id: runId,
      workspaceId,
      issueId,
      agentId,
      hostName: agentId,
      status: 'running',
      workflowInstanceId: runId,
    })
    await testDb.db.insert(schema.issueWorkProduct).values({
      id: workProductId,
      workspaceId,
      issueId,
      runId,
      agentId,
      type: 'brief',
      title: 'Draft v1',
      body: 'Body v1',
    })
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  function tool() {
    const context = {
      env: { HYPERDRIVE: { connectionString: testDb.databaseUrl } },
      getRunState: () => ({
        runId,
        workspaceId,
        issueId,
        agentId,
        agentOwnerUserId: ownerId,
        hostName: agentId,
      }),
      recordResolution: () => {},
      captureAnalytics: () => {},
    } as unknown as IssueRunToolContext
    return createReviseWorkProductTool(context)
  }

  async function revise(input: {
    body: string
    title?: string
    change_summary?: string
  }) {
    // Each revise finishes the run, so reopen it to model the next run.
    await testDb.db
      .update(schema.issueRun)
      .set({ status: 'running', finishedAt: null })
      .where(eq(schema.issueRun.id, runId))
    return tool().execute!(
      { id: workProductId, ...input },
      { toolCallId: randomUUID(), messages: [] },
    )
  }

  it('appends each replaced version to payload.previous_versions', async () => {
    const first = await revise({
      body: 'Body v2',
      title: 'Draft v2',
      change_summary: 'Tightened intro',
    })
    expect(first).toEqual(
      expect.objectContaining({ ok: true, previous_versions_count: 1 }),
    )

    const second = await revise({ body: 'Body v3' })
    expect(second).toEqual(
      expect.objectContaining({ ok: true, previous_versions_count: 2 }),
    )

    const [row] = await testDb.db
      .select()
      .from(schema.issueWorkProduct)
      .where(eq(schema.issueWorkProduct.id, workProductId))
    expect(row?.body).toBe('Body v3')
    const versions = (row?.payload as { previous_versions: unknown[] })
      .previous_versions
    expect(versions).toHaveLength(2)
    expect(versions[0]).toMatchObject({
      body: 'Body v1',
      title: 'Draft v1',
      agent_id: agentId,
      change_summary: 'Tightened intro',
    })
    expect(versions[1]).toMatchObject({
      body: 'Body v2',
      title: 'Draft v2',
      change_summary: null,
    })
  })
})
