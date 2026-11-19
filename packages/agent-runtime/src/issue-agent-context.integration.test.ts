import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  ISSUE_CONTEXT_RESET_MESSAGE,
  issueIdFromFacetName,
  issueRunFacetName,
  readIssueAgentContextGeneration,
  resetIssueAgentContext,
} from './issue-agent-context'

describe('issue run facet names', () => {
  it('keeps generation 0 on the bare issue id and round-trips later generations', () => {
    const issueId = randomUUID()
    expect(issueRunFacetName(issueId, 0)).toBe(issueId)
    expect(issueRunFacetName(issueId, 2)).toBe(`${issueId}:ctx2`)
    for (const generation of [0, 1, 12])
      expect(issueIdFromFacetName(issueRunFacetName(issueId, generation))).toBe(
        issueId,
      )
  })
})

describe('resetIssueAgentContext (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function seedIssueWithRuns(runCount: number) {
    const workspaceId = randomUUID()
    const userId = randomUUID()
    const agentId = randomUUID()
    const issueId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Context reset workspace',
      slug: `context-reset-${workspaceId}`,
    })
    await testDb.db
      .insert(schema.user)
      .values({ id: userId, email: `${userId}@example.com`, name: 'Owner' })
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId: userId,
      name: 'Agent',
      hostName: agentId,
    })
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId,
      number: 1,
      title: 'Legacy history issue',
      createdBy: userId,
    })
    const runIds = Array.from({ length: runCount }, () => randomUUID())
    for (const runId of runIds)
      await testDb.db.insert(schema.issueRun).values({
        id: runId,
        workspaceId,
        issueId,
        agentId,
        hostName: agentId,
        workflowInstanceId: runId,
      })
    return { workspaceId, userId, agentId, issueId, runIds }
  }

  async function seedSecondAgentRun(seeded: {
    workspaceId: string
    userId: string
    issueId: string
  }) {
    const agentId = randomUUID()
    const runId = randomUUID()
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId: seeded.workspaceId,
      ownerUserId: seeded.userId,
      name: 'Second agent',
      hostName: agentId,
    })
    await testDb.db.insert(schema.issueRun).values({
      id: runId,
      workspaceId: seeded.workspaceId,
      issueId: seeded.issueId,
      agentId,
      hostName: agentId,
      workflowInstanceId: runId,
    })
    return { agentId, runId }
  }

  async function resetEvents(runId: string) {
    return (
      await testDb.db
        .select()
        .from(schema.issueRunEvent)
        .where(eq(schema.issueRunEvent.runId, runId))
    ).filter((event) => event.eventType === 'issue_run:context_reset')
  }

  it('bumps once per run, so a retried Workflow step converges on the same generation', async () => {
    const { issueId, agentId, runIds } = await seedIssueWithRuns(1)
    const runId = runIds[0]!
    const first = await resetIssueAgentContext(testDb.db, {
      issueId,
      agentId,
      runId,
      observedGeneration: 0,
    })
    expect(first.unwrap()).toBe(1)
    const retried = await resetIssueAgentContext(testDb.db, {
      issueId,
      agentId,
      runId,
      observedGeneration: 0,
    })
    expect(retried.unwrap()).toBe(1)
    const afterFreshRefusal = await resetIssueAgentContext(testDb.db, {
      issueId,
      agentId,
      runId,
      observedGeneration: 1,
    })
    expect(
      afterFreshRefusal.unwrap(),
      'a run that already reset gets no second fresh context',
    ).toBe(1)
    expect(
      (
        await readIssueAgentContextGeneration(testDb.db, { issueId, agentId })
      ).unwrap(),
    ).toBe(1)
    const events = await resetEvents(runId)
    expect(events).toHaveLength(1)
    expect(events[0]!.message).toBe(ISSUE_CONTEXT_RESET_MESSAGE)
    expect(events[0]!.payload).toEqual({
      from_generation: 0,
      to_generation: 1,
    })
  })

  it('moves to an already-bumped generation without bumping again', async () => {
    const { issueId, agentId, runIds } = await seedIssueWithRuns(2)
    const [winner, stale] = runIds as [string, string]
    expect(
      (
        await resetIssueAgentContext(testDb.db, {
          issueId,
          agentId,
          runId: winner,
          observedGeneration: 0,
        })
      ).unwrap(),
    ).toBe(1)
    expect(
      (
        await resetIssueAgentContext(testDb.db, {
          issueId,
          agentId,
          runId: stale,
          observedGeneration: 0,
        })
      ).unwrap(),
    ).toBe(1)
    expect(await resetEvents(stale)).toHaveLength(0)
  })

  it('serializes concurrent resets from the same observed generation', async () => {
    const { issueId, agentId, runIds } = await seedIssueWithRuns(2)
    const results = await Promise.all(
      runIds.map((runId) =>
        resetIssueAgentContext(testDb.db, {
          issueId,
          agentId,
          runId,
          observedGeneration: 0,
        }),
      ),
    )
    expect(results.map((result) => result.unwrap())).toEqual([1, 1])
    expect(
      (
        await readIssueAgentContextGeneration(testDb.db, { issueId, agentId })
      ).unwrap(),
    ).toBe(1)
  })

  it("leaves another agent's context on the same issue untouched (#408)", async () => {
    const seeded = await seedIssueWithRuns(1)
    const { issueId } = seeded
    const agentA = seeded.agentId
    const agentB = await seedSecondAgentRun(seeded)
    const facetFor = async (agentId: string) =>
      issueRunFacetName(
        issueId,
        (
          await readIssueAgentContextGeneration(testDb.db, { issueId, agentId })
        ).unwrap(),
      )
    expect(await facetFor(agentB.agentId)).toBe(issueId)

    expect(
      (
        await resetIssueAgentContext(testDb.db, {
          issueId,
          agentId: agentA,
          runId: seeded.runIds[0]!,
          observedGeneration: 0,
        })
      ).unwrap(),
    ).toBe(1)

    expect(await facetFor(agentA)).toBe(`${issueId}:ctx1`)
    expect(
      await facetFor(agentB.agentId),
      'agent B keeps its retained facet',
    ).toBe(issueId)
    expect(
      (
        await resetIssueAgentContext(testDb.db, {
          issueId,
          agentId: agentB.agentId,
          runId: agentB.runId,
          observedGeneration: 0,
        })
      ).unwrap(),
      "agent B's own reset is not blocked by agent A's",
    ).toBe(1)
    expect(await resetEvents(agentB.runId)).toHaveLength(1)
  })
})
