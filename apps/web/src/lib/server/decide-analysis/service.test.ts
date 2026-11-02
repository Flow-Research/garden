// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { DecideAnalysisWorkflowParams } from '@garden/agent-runtime/src/decide-analysis-types'
import {
  describeDatabaseError,
  finishDecideAnalysis,
  markDecideAnalysisDelivered,
  retryDecideAnalysis,
  startDecideAnalysis,
  toPublicDecideAnalysis,
  type DecideAnalysisEnvironment,
} from './service'

let testDb: TestDb
let env: DecideAnalysisEnvironment
const workflowStarts: DecideAnalysisWorkflowParams[] = []

beforeAll(async () => {
  testDb = await startTestDb()
  env = {
    HYPERDRIVE: { connectionString: testDb.databaseUrl },
    DECIDE_ANALYSIS_WORKFLOW: {
      create: async ({ params }) => {
        workflowStarts.push(params)
        return {}
      },
    },
  } as DecideAnalysisEnvironment
}, 120_000)

afterAll(async () => {
  await testDb?.cleanup()
})

async function seedThread(options: { primaryIssue?: boolean } = {}) {
  const workspaceId = randomUUID()
  const ownerUserId = randomUUID()
  const agentId = randomUUID()
  const threadId = randomUUID()
  await testDb.db.insert(schema.user).values({
    id: ownerUserId,
    email: `${ownerUserId}@example.com`,
    name: 'Owner',
  })
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Decide workspace',
    slug: `decide-${workspaceId}`,
  })
  await testDb.db.insert(schema.agent).values({
    id: agentId,
    workspaceId,
    ownerUserId,
    name: 'Agent',
    hostName: `host-${agentId}`,
    status: 'active',
  })
  // An issue-linked thread's facet is named by the issue ID, so its
  // runtime_key differs from its row ID.
  const runtimeKey = options.primaryIssue ? randomUUID() : threadId
  await testDb.db.insert(schema.chatThread).values({
    id: threadId,
    workspaceId,
    ownerUserId,
    agentId,
    runtimeKey,
    title: 'Revenue',
  })
  return { workspaceId, ownerUserId, agentId, threadId, runtimeKey }
}

type Thread = Awaited<ReturnType<typeof seedThread>>

async function seedSiblingThread(thread: Thread): Promise<Thread> {
  const threadId = randomUUID()
  await testDb.db.insert(schema.chatThread).values({
    id: threadId,
    workspaceId: thread.workspaceId,
    ownerUserId: thread.ownerUserId,
    agentId: thread.agentId,
    runtimeKey: threadId,
    title: 'Churn',
  })
  return { ...thread, threadId, runtimeKey: threadId }
}

const start = (
  thread: Thread,
  input: { data?: string; threadKey?: string; key?: string } = {},
) =>
  startDecideAnalysis({
    env,
    workspaceId: thread.workspaceId,
    ownerUserId: thread.ownerUserId,
    threadId: input.threadKey ?? thread.threadId,
    idempotencyKey: input.key ?? randomUUID(),
    question: 'What drove revenue?',
    ...(input.data === undefined ? {} : { data: input.data }),
  })

const runsFor = (threadId: string) =>
  testDb.db
    .select()
    .from(schema.decideAnalysisRun)
    .where(eq(schema.decideAnalysisRun.threadId, threadId))

async function startAndFinish(
  thread: Thread,
  outcome: { sessionId: string; failed?: boolean },
  data?: string,
) {
  const started = (await start(thread, { data })).unwrap()
  await finishDecideAnalysis(env, {
    runId: started.snapshot.runId,
    attempt: 1,
    providerSessionId: outcome.sessionId,
    ...(outcome.failed
      ? { error: { code: 'provider_error', message: 'No credits.' } }
      : { result: { content: [] } }),
  })
  return started.snapshot.runId
}

describe('startDecideAnalysis', () => {
  it('returns the active run instead of starting a second paid run', async () => {
    const thread = await seedThread()
    const first = (await start(thread, { data: 'a,b\n1,2' })).unwrap()
    const startsBefore = workflowStarts.length

    const second = (await start(thread, { data: 'a,b\n1,2' })).unwrap()

    expect(first.kind).toBe('started')
    expect(second.kind).toBe('already_running')
    expect(second.snapshot.runId).toBe(first.snapshot.runId)
    expect(await runsFor(thread.threadId)).toHaveLength(1)
    expect(workflowStarts.length).toBe(startsBefore)
  })

  it('starts a fresh run when another thread reused the tool-call key', async () => {
    const other = await seedThread()
    const otherRunId = await startAndFinish(
      other,
      { sessionId: 'sess-other', failed: true },
      'a\n1',
    )
    const otherKey = (await runsFor(other.threadId))[0]!.idempotencyKey
    const thread = await seedSiblingThread(other)

    const started = (
      await start(thread, { data: 'a\n1', key: otherKey })
    ).unwrap()

    expect(started.kind).toBe('started')
    expect(started.snapshot.runId).not.toBe(otherRunId)
    expect(await runsFor(thread.threadId)).toHaveLength(1)
  })

  it('starts a fresh run when a finished run in the thread reused the key', async () => {
    const thread = await seedThread()
    await startAndFinish(thread, { sessionId: 'sess-1' }, 'a\n1')
    const key = (await runsFor(thread.threadId))[0]!.idempotencyKey

    const started = (await start(thread, { data: 'a\n2', key })).unwrap()

    expect(started.kind).toBe('started')
    expect(await runsFor(thread.threadId)).toHaveLength(2)
  })

  it('collapses concurrent starts in one thread to one run', async () => {
    const thread = await seedThread()

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => start(thread, { data: 'a\n1' })),
    )

    const kinds = outcomes.map((outcome) => outcome.unwrap().kind).sort()
    expect(kinds).toEqual([
      'already_running',
      'already_running',
      'already_running',
      'started',
    ])
    expect(await runsFor(thread.threadId)).toHaveLength(1)
  })

  it('continues the latest completed session when data is omitted', async () => {
    const thread = await seedThread()
    await startAndFinish(thread, { sessionId: 'sess_old' }, 'a\n1')
    await startAndFinish(thread, { sessionId: 'sess_latest' }, 'a\n2')
    await startAndFinish(
      thread,
      { sessionId: 'sess_failed', failed: true },
      'a\n3',
    )

    const followUp = (await start(thread)).unwrap()

    expect(followUp.snapshot.providerSessionId).toBe('sess_latest')
  })

  it('never seeds a follow-up from a failed run', async () => {
    const thread = await seedThread()
    await startAndFinish(
      thread,
      { sessionId: 'sess_failed', failed: true },
      'a\n1',
    )

    const followUp = await start(thread)

    expect(followUp.isErr() && followUp.error.code).toBe('invalid_input')
    expect(await runsFor(thread.threadId)).toHaveLength(1)
  })

  it('asks for data instead of paying Decide for a run with nothing to analyze', async () => {
    const thread = await seedThread()
    const startsBefore = workflowStarts.length

    const result = await start(thread)

    expect(result.isErr() && result.error.code).toBe('invalid_input')
    expect(result.isErr() && result.error.message).toMatch(/attach|data/i)
    expect(await runsFor(thread.threadId)).toHaveLength(0)
    expect(workflowStarts.length).toBe(startsBefore)
  })

  it('starts a fresh session when new data arrives', async () => {
    const thread = await seedThread()
    await startAndFinish(thread, { sessionId: 'sess_done' }, 'a\n1')

    const fresh = (await start(thread, { data: 'b\n2' })).unwrap()

    expect(fresh.snapshot.providerSessionId).toBeNull()
  })

  it('resolves an issue-linked thread by its runtime key', async () => {
    const thread = await seedThread({ primaryIssue: true })

    const started = (
      await start(thread, { threadKey: thread.runtimeKey, data: 'a\n1' })
    ).unwrap()

    expect(started.kind).toBe('started')
    expect(started.snapshot.threadId).toBe(thread.threadId)
  })

  it('does not resolve a thread owned by another user', async () => {
    const thread = await seedThread()
    const other = await seedThread()

    const result = await start(
      { ...thread, ownerUserId: other.ownerUserId },
      { data: 'a\n1' },
    )

    expect(result.isErr() && result.error.code).toBe('not_found')
  })
})

describe('retryDecideAnalysis', () => {
  it('refuses to retry while another run is active in the thread', async () => {
    const thread = await seedThread()
    const failedRunId = await startAndFinish(
      thread,
      { sessionId: 'sess_failed', failed: true },
      'a\n1',
    )
    await start(thread, { data: 'a\n2' })

    const retried = await retryDecideAnalysis({
      env,
      workspaceId: thread.workspaceId,
      ownerUserId: thread.ownerUserId,
      threadId: thread.threadId,
      runId: failedRunId,
      retryKey: randomUUID(),
    })

    expect(retried.isErr() && retried.error.code).toBe('conflict')
  })
})

describe('markDecideAnalysisDelivered', () => {
  it('keeps the first delivery time when a step replays', async () => {
    const thread = await seedThread()
    const runId = await startAndFinish(thread, { sessionId: 's' }, 'a\n1')

    await markDecideAnalysisDelivered(env, { runId, attempt: 1 })
    const [first] = await runsFor(thread.threadId)
    await markDecideAnalysisDelivered(env, { runId, attempt: 1 })
    const [second] = await runsFor(thread.threadId)

    expect(first?.deliveredAt).toBeInstanceOf(Date)
    expect(second?.deliveredAt?.getTime()).toBe(first?.deliveredAt?.getTime())
  })
})

describe('toPublicDecideAnalysis', () => {
  it('keeps the provider session and raw Decide result out of the browser shape', async () => {
    const thread = await seedThread()
    const started = (await start(thread, { data: 'a\n1' })).unwrap()
    const finished = (
      await finishDecideAnalysis(env, {
        runId: started.snapshot.runId,
        attempt: started.snapshot.attempt,
        result: { content: [{ type: 'text', text: 'Session ID: sess_1' }] },
        providerSessionId: 'sess_1',
      })
    ).unwrap()

    const shape = toPublicDecideAnalysis(finished!)

    expect(shape).toMatchObject({
      runId: started.snapshot.runId,
      status: 'completed',
    })
    expect(JSON.stringify(shape)).not.toContain('sess_1')
  })
})

describe('toPublicDecideAnalysis files', () => {
  it('lists the files Decide linked in its text', async () => {
    const thread = await seedThread()
    const started = (await start(thread, { data: 'a\n1' })).unwrap()
    const url =
      'https://api.trydecide.co/uploads/agent-sessions/sess_1_ab/outputs/revenue.xlsx'
    const finished = (
      await finishDecideAnalysis(env, {
        runId: started.snapshot.runId,
        attempt: started.snapshot.attempt,
        result: {
          content: [{ type: 'text', text: `Workbook: ${url}` }],
        },
        providerSessionId: null,
      })
    ).unwrap()

    expect(toPublicDecideAnalysis(finished!).files).toEqual([
      { name: 'revenue.xlsx', url },
    ])
  })

  it('lists no files while the run is active', async () => {
    const thread = await seedThread()
    const started = (await start(thread, { data: 'a\n1' })).unwrap()

    expect(toPublicDecideAnalysis(started.snapshot).files).toEqual([])
  })
})

describe('describeDatabaseError', () => {
  it('names the Postgres code and constraint behind a Drizzle query error', () => {
    const pg = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'decide_analysis_run_workspace_idempotency_idx',
    })
    const drizzle = new Error('Failed query: insert into ... params: secret', {
      cause: pg,
    })
    expect(describeDatabaseError(drizzle)).toBe(
      'Postgres 23505 on decide_analysis_run_workspace_idempotency_idx: duplicate key value',
    )
  })

  it('falls back to the message when no Postgres error is present', () => {
    expect(describeDatabaseError(new Error('boom'))).toBe('boom')
  })
})
