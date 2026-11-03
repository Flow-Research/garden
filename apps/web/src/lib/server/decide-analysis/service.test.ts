// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { DecideAnalysisWorkflowParams } from '@garden/agent-runtime/src/decide-analysis-types'
import {
  exceedsInputLimit,
  cancelDecideAnalysis,
  DECIDE_ANALYSIS_INPUT_LIMIT_BYTES,
  DecideAnalysisServiceError,
  describeDatabaseError,
  getDecideAnalysis,
  finishDecideAnalysis,
  markDecideAnalysisDelivered,
  retryDecideAnalysis,
  startDecideAnalysis,
  toPublicDecideAnalysis,
  type DecideAnalysisEnvironment,
  type DecideAnalysisInputData,
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

const chat = (threadId: string) => ({ kind: 'chat' as const, threadId })

const start = (
  thread: Thread,
  input: { data?: string; threadKey?: string; key?: string } = {},
) =>
  startDecideAnalysis({
    env,
    workspaceId: thread.workspaceId,
    ownerUserId: thread.ownerUserId,
    owner: chat(input.threadKey ?? thread.threadId),
    idempotencyKey: input.key ?? randomUUID(),
    question: 'What drove revenue?',
    ...(input.data === undefined
      ? {}
      : { input: { kind: 'text' as const, text: input.data } }),
  })

async function seedAutomationRun(thread: Thread) {
  const automationId = randomUUID()
  const automationRunId = randomUUID()
  await testDb.db.insert(schema.automation).values({
    id: automationId,
    workspaceId: thread.workspaceId,
    title: 'Weekly report',
    assigneeAgentId: thread.agentId,
    createdBy: thread.ownerUserId,
  })
  await testDb.db.insert(schema.automationRun).values({
    id: automationRunId,
    workspaceId: thread.workspaceId,
    automationId,
    source: 'manual',
    status: 'running',
    agentId: thread.agentId,
    hostName: `host-${thread.agentId}`,
  })
  return automationRunId
}

const startForAutomation = (
  thread: Thread,
  automationRunId: string,
  data?: string,
) =>
  startDecideAnalysis({
    env,
    workspaceId: thread.workspaceId,
    ownerUserId: thread.ownerUserId,
    owner: { kind: 'automation_run', automationRunId },
    idempotencyKey: randomUUID(),
    question: 'Which region grew fastest?',
    ...(data === undefined
      ? {}
      : { input: { kind: 'text' as const, text: data } }),
  })

const runsForAutomation = (automationRunId: string) =>
  testDb.db
    .select()
    .from(schema.decideAnalysisRun)
    .where(eq(schema.decideAnalysisRun.automationRunId, automationRunId))

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
    expect(started.snapshot.owner).toEqual(chat(thread.threadId))
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

describe('startDecideAnalysis input', () => {
  const brainFile = { kind: 'brain_file' as const, fileId: 'file_1' }
  const startWith = (thread: Thread, input: DecideAnalysisInputData) =>
    startDecideAnalysis({
      env,
      workspaceId: thread.workspaceId,
      ownerUserId: thread.ownerUserId,
      owner: chat(thread.threadId),
      idempotencyKey: randomUUID(),
      question: 'Which region grew fastest?',
      input,
    })

  it('stores the full text Garden read from a Brain source', async () => {
    const thread = await seedThread()
    const sheet = 'region\trevenue\nNorth\t120\nSouth\t95\n'
    const reads: unknown[] = []

    const started = await startWith(thread, {
      kind: 'source',
      source: brainFile,
      read: async (request) => {
        reads.push(request)
        return Result.ok(sheet)
      },
    })

    expect(started.isOk()).toBe(true)
    expect(reads).toEqual([
      {
        workspaceId: thread.workspaceId,
        ownerUserId: thread.ownerUserId,
        source: brainFile,
      },
    ])
    const [row] = await runsFor(thread.threadId)
    expect(row?.inputData).toBe(sheet)
    expect(row?.providerSessionId).toBeNull()
  })

  it('creates no run when the source cannot be read', async () => {
    const thread = await seedThread()
    const startsBefore = workflowStarts.length

    const result = await startWith(thread, {
      kind: 'source',
      source: brainFile,
      read: async () =>
        Result.err(
          new DecideAnalysisServiceError({
            code: 'source_unavailable',
            message: 'The Brain file is unavailable.',
          }),
        ),
    })

    expect(result.isErr() && result.error.code).toBe('source_unavailable')
    expect(await runsFor(thread.threadId)).toHaveLength(0)
    expect(workflowStarts.length).toBe(startsBefore)
  })

  it('refuses an empty source instead of continuing an earlier session', async () => {
    const thread = await seedThread()
    await startAndFinish(thread, { sessionId: 'sess_done' }, 'a\n1')

    const result = await startWith(thread, {
      kind: 'source',
      source: brainFile,
      read: async () => Result.ok('  \n'),
    })

    expect(result.isErr() && result.error.code).toBe('source_unavailable')
    expect(await runsFor(thread.threadId)).toHaveLength(1)
  })

  it('rejects input over 100 MB of UTF-8 before a paid run starts', async () => {
    const thread = await seedThread()
    const startsBefore = workflowStarts.length
    // Two UTF-8 bytes per character: under the limit in characters, over it
    // in bytes.
    const oversized = 'é'.repeat(DECIDE_ANALYSIS_INPUT_LIMIT_BYTES / 2 + 1)

    const pasted = await startWith(thread, { kind: 'text', text: oversized })
    const sourced = await startWith(thread, {
      kind: 'source',
      source: brainFile,
      read: async () => Result.ok(oversized),
    })

    expect(pasted.isErr() && pasted.error.code).toBe('input_too_large')
    expect(sourced.isErr() && sourced.error.code).toBe('input_too_large')
    expect(pasted.isErr() && pasted.error.message).toMatch(/100 MB/)
    expect(await runsFor(thread.threadId)).toHaveLength(0)
    expect(workflowStarts.length).toBe(startsBefore)
  })

  // The size check is pure; inserting 100 MB into the test database timed
  // out, so the boundary is checked without a run.
  it('accepts input exactly at the limit and rejects one byte more', () => {
    const atLimit = 'x'.repeat(DECIDE_ANALYSIS_INPUT_LIMIT_BYTES)
    expect(exceedsInputLimit(atLimit)).toBe(false)
    expect(exceedsInputLimit(`${atLimit}x`)).toBe(true)
  })
})

describe('decide_analysis_run owner', () => {
  const rawRun = (thread: Thread, owner: Record<string, unknown>) => {
    const id = randomUUID()
    return testDb.db.insert(schema.decideAnalysisRun).values({
      id,
      workspaceId: thread.workspaceId,
      ownerUserId: thread.ownerUserId,
      agentId: thread.agentId,
      agentRuntimeName: 'host',
      idempotencyKey: id,
      workflowInstanceId: id,
      question: 'q',
      ...owner,
    })
  }

  it('stores existing-style chat inserts as chat owners', async () => {
    const thread = await seedThread()
    await rawRun(thread, { threadId: thread.threadId })

    const [row] = await runsFor(thread.threadId)

    expect(row?.ownerKind).toBe('chat')
    expect(row?.automationRunId).toBeNull()
  })

  it('rejects a row whose ids do not match its owner kind', async () => {
    const thread = await seedThread()
    const automationRunId = await seedAutomationRun(thread)

    const outcomes = await Promise.allSettled([
      rawRun(thread, { ownerKind: 'chat' }),
      rawRun(thread, {
        ownerKind: 'chat',
        threadId: thread.threadId,
        automationRunId,
      }),
      rawRun(thread, {
        ownerKind: 'automation_run',
        threadId: thread.threadId,
      }),
      rawRun(thread, {
        ownerKind: 'automation_run',
        automationRunId,
        threadId: thread.threadId,
      }),
    ])

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
    ])
  })

  it('allows one active run per automation run, independent of chats', async () => {
    const thread = await seedThread()
    const automationRunId = await seedAutomationRun(thread)
    const chatRun = (await start(thread, { data: 'a\n1' })).unwrap()

    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () =>
        startForAutomation(thread, automationRunId, 'a\n1'),
      ),
    )

    const kinds = outcomes.map((outcome) => outcome.unwrap().kind).sort()
    expect(kinds).toEqual(['already_running', 'already_running', 'started'])
    const [row] = await runsForAutomation(automationRunId)
    expect(row).toMatchObject({ ownerKind: 'automation_run', threadId: null })
    expect(row?.id).not.toBe(chatRun.snapshot.runId)
    expect(outcomes[0]?.unwrap().snapshot.owner).toEqual({
      kind: 'automation_run',
      automationRunId,
    })
  })

  it('reuses only the same automation run session for a follow-up', async () => {
    const thread = await seedThread()
    await startAndFinish(thread, { sessionId: 'sess_chat' }, 'a\n1')
    const automationRunId = await seedAutomationRun(thread)

    const followUp = await startForAutomation(thread, automationRunId)

    expect(followUp.isErr() && followUp.error.code).toBe('invalid_input')
  })

  it('does not start a run for an automation run in another workspace', async () => {
    const thread = await seedThread()
    const other = await seedThread()
    const automationRunId = await seedAutomationRun(other)

    const result = await startForAutomation(thread, automationRunId, 'a\n1')

    expect(result.isErr() && result.error.code).toBe('not_found')
  })

  it('hides a chat run from the same user in another thread', async () => {
    const thread = await seedThread()
    const sibling = await seedSiblingThread(thread)
    const started = (await start(thread, { data: 'a\n1' })).unwrap()
    const actor = (threadId: string) => ({
      workspaceId: thread.workspaceId,
      ownerUserId: thread.ownerUserId,
      owner: chat(threadId),
    })

    const own = await getDecideAnalysis(
      env,
      actor(thread.threadId),
      started.snapshot.runId,
    )
    const foreign = await getDecideAnalysis(
      env,
      actor(sibling.threadId),
      started.snapshot.runId,
    )
    const foreignCancel = await cancelDecideAnalysis(
      env,
      actor(sibling.threadId),
      started.snapshot.runId,
    )

    expect(own.isOk()).toBe(true)
    expect(foreign.isErr() && foreign.error.code).toBe('not_found')
    expect(foreignCancel.isErr() && foreignCancel.error.code).toBe('not_found')
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
      owner: chat(thread.threadId),
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
