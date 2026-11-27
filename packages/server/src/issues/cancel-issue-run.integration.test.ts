import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { RunWorkflowBinding } from '../runtime-bindings'
import { cancelIssueRun, type IssueRunEnv } from './run-service'

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

describe('cancelIssueRun (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    testDbRef.url = testDb.databaseUrl
    testDbRef.db = testDb.db
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function seedLiveRun(status: 'waiting_for_input' | 'running') {
    const workspaceId = randomUUID()
    const userId = randomUUID()
    const agentId = randomUUID()
    const issueId = randomUUID()
    const runId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Cancel run workspace',
      slug: `cancel-${workspaceId}`,
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
      title: 'Stuck issue',
      createdBy: userId,
    })
    await testDb.db.insert(schema.issueRun).values({
      id: runId,
      workspaceId,
      issueId,
      agentId,
      hostName: agentId,
      status,
      workflowInstanceId: runId,
    })
    await testDb.db
      .update(schema.issue)
      .set({ activeRunId: runId })
      .where(eq(schema.issue.id, issueId))
    return { workspaceId, userId, issueId, runId }
  }

  function envWith(workflow: RunWorkflowBinding): IssueRunEnv {
    return {
      HYPERDRIVE: { connectionString: testDb.databaseUrl },
      RUN_WORKFLOW: workflow,
      AgentDO: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({
          startIssueRunWorkflow: async () => {},
          cancelIssueRun: async () => {},
        }),
      } as unknown as IssueRunEnv['AgentDO'],
    }
  }

  async function readState(runId: string, issueId: string) {
    const [run] = await testDb.db
      .select()
      .from(schema.issueRun)
      .where(eq(schema.issueRun.id, runId))
    const [issue] = await testDb.db
      .select({ activeRunId: schema.issue.activeRunId })
      .from(schema.issue)
      .where(eq(schema.issue.id, issueId))
    const events = await testDb.db
      .select({ eventType: schema.issueRunEvent.eventType })
      .from(schema.issueRunEvent)
      .where(eq(schema.issueRunEvent.runId, runId))
    return { run, issue, eventTypes: events.map((e) => e.eventType) }
  }

  it.each(['waiting_for_input', 'running'] as const)(
    'finalizes a %s run as cancelled when its workflow instance is gone',
    async (status) => {
      const seeded = await seedLiveRun(status)
      const env = envWith({
        get: async () => {
          throw new Error('(instance.not_found) Instance not found')
        },
      })

      const result = await cancelIssueRun(env, {
        workspaceId: seeded.workspaceId,
        runId: seeded.runId,
        actor: { type: 'member', id: seeded.userId },
        reason: 'user_cancelled',
      })

      expect(result.isOk()).toBe(true)
      const state = await readState(seeded.runId, seeded.issueId)
      expect(state.run?.status).toBe('cancelled')
      expect(state.run?.finishedAt).not.toBeNull()
      expect(state.run?.resultJson).toMatchObject({
        resolution: 'cancelled',
        reason: 'workflow_instance_missing',
      })
      expect(state.issue?.activeRunId).toBeNull()
      expect(state.eventTypes).toContain('issue_run:cancelled')
    },
  )

  it('finalizes the run when the workflow instance is already terminal', async () => {
    const seeded = await seedLiveRun('waiting_for_input')
    const env = envWith({
      get: async () => ({
        sendEvent: async () => {
          throw new Error('(instance.not_running) Instance is not running')
        },
        status: async () => ({ status: 'complete' }),
      }),
    })

    const result = await cancelIssueRun(env, {
      workspaceId: seeded.workspaceId,
      runId: seeded.runId,
      actor: { type: 'member', id: seeded.userId },
      reason: 'issue_changed',
    })

    expect(result.isOk()).toBe(true)
    const state = await readState(seeded.runId, seeded.issueId)
    expect(state.run?.status).toBe('cancelled')
    expect(state.run?.resultJson).toMatchObject({
      reason: 'workflow_instance_terminal',
    })
    expect(state.issue?.activeRunId).toBeNull()
  })

  it('surfaces other workflow errors and leaves the run live', async () => {
    const seeded = await seedLiveRun('waiting_for_input')
    const env = envWith({
      get: async () => {
        throw new Error('(internal) Workflows service unavailable')
      },
    })

    const result = await cancelIssueRun(env, {
      workspaceId: seeded.workspaceId,
      runId: seeded.runId,
      actor: { type: 'member', id: seeded.userId },
      reason: 'user_cancelled',
    })

    expect(result.isErr()).toBe(true)
    const state = await readState(seeded.runId, seeded.issueId)
    expect(state.run?.status).toBe('waiting_for_input')
    expect(state.run?.finishedAt).toBeNull()
    expect(state.issue?.activeRunId).toBe(seeded.runId)
    expect(state.eventTypes).not.toContain('issue_run:cancelled')
  })
})
