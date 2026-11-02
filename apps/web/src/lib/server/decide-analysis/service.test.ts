// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { DecideAnalysisWorkflowParams } from '@garden/agent-runtime/src/decide-analysis-types'
import {
  finishDecideAnalysis,
  markDecideAnalysisDelivered,
  retryDecideAnalysis,
  startDecideAnalysis,
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
  return { workspaceId, ownerUserId, threadId, runtimeKey }
}

type Thread = Awaited<ReturnType<typeof seedThread>>

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

    const followUp = (await start(thread)).unwrap()

    expect(followUp.snapshot.providerSessionId).toBeNull()
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
