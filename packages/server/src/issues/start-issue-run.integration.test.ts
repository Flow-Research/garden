import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { startIssueRun, type IssueRunEnv } from './run-service'

const testDbRef = vi.hoisted(() => ({ url: '', db: undefined as unknown }))

vi.mock('@garden/db/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@garden/db/runtime')>()
  return {
    ...actual,
    getPooledDb: (connectionString: string) =>
      connectionString === testDbRef.url && testDbRef.db
        ? (testDbRef.db as ReturnType<typeof actual.getPooledDb>)
        : actual.getPooledDb(connectionString),
  }
})

describe('startIssueRun (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    testDbRef.url = testDb.databaseUrl
    testDbRef.db = testDb.db
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function seedIssue() {
    const workspaceId = randomUUID()
    const userId = randomUUID()
    const agentId = randomUUID()
    const issueId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Start run workspace',
      slug: `start-${workspaceId}`,
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
      title: 'Start me',
      createdBy: userId,
    })
    return { workspaceId, userId, agentId, issueId }
  }

  function envWith(
    startIssueRunWorkflow: (input: {
      runId: string
      issueId: string
    }) => Promise<void>,
  ): IssueRunEnv {
    return {
      HYPERDRIVE: { connectionString: testDb.databaseUrl },
      AgentDO: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({ startIssueRunWorkflow, cancelIssueRun: async () => {} }),
      } as unknown as IssueRunEnv['AgentDO'],
    }
  }

  it('creates one run for concurrent starts and returns it to the duplicate', async () => {
    const seeded = await seedIssue()
    const started: string[] = []
    const env = envWith(async ({ runId }) => {
      started.push(runId)
    })
    const input = {
      workspaceId: seeded.workspaceId,
      issueId: seeded.issueId,
      agentId: seeded.agentId,
      source: 'manual' as const,
      actor: { type: 'member' as const, id: seeded.userId },
    }

    const outcomes = await Promise.all([
      startIssueRun(env, input),
      startIssueRun(env, input),
    ])

    const runs = await testDb.db
      .select({ id: schema.issueRun.id })
      .from(schema.issueRun)
      .where(eq(schema.issueRun.issueId, seeded.issueId))
    expect(runs).toHaveLength(1)
    const runId = runs[0]!.id
    expect(started).toEqual([runId])
    const values = outcomes.map((outcome) => outcome.unwrap())
    expect(values).toEqual(
      expect.arrayContaining([
        { kind: 'started', runId },
        { kind: 'already_running', runId },
      ]),
    )
  })

  it('marks the run failed and clears active_run_id when workflow start fails', async () => {
    const seeded = await seedIssue()
    const env = envWith(async () => {
      throw new Error('workflow create exploded')
    })

    const result = await startIssueRun(env, {
      workspaceId: seeded.workspaceId,
      issueId: seeded.issueId,
      agentId: seeded.agentId,
      source: 'manual',
      actor: { type: 'member', id: seeded.userId },
    })

    expect(result.isErr()).toBe(true)
    const [run] = await testDb.db
      .select()
      .from(schema.issueRun)
      .where(eq(schema.issueRun.issueId, seeded.issueId))
    expect(run?.status).toBe('failed')
    expect(run?.error).toContain('workflow create exploded')
    expect(run?.finishedAt).not.toBeNull()
    const [issue] = await testDb.db
      .select({ activeRunId: schema.issue.activeRunId })
      .from(schema.issue)
      .where(eq(schema.issue.id, seeded.issueId))
    expect(issue?.activeRunId).toBeNull()
    const events = await testDb.db
      .select({ eventType: schema.issueRunEvent.eventType })
      .from(schema.issueRunEvent)
      .where(eq(schema.issueRunEvent.runId, run!.id))
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['issue_run:queued', 'issue_run:failed']),
    )
  })
})
