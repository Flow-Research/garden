import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type {
  DecideAnalysisProgress,
  DecideAnalysisSnapshot,
  DecideAnalysisStartOutcome,
  DecideAnalysisStatus,
  DecideAnalysisWorkflowBinding,
  DecideAnalysisWorkflowParams,
} from '@garden/agent-runtime/src/decide-analysis-types'
import { DECIDE_ANALYSIS_STATUSES } from '@garden/agent-runtime/src/decide-analysis-types'
import { createRuntimeDbClient, type Db } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import type { HyperdriveConnection } from '@garden/server/runtime-bindings'

export class DecideAnalysisServiceError extends TaggedError(
  'DecideAnalysisServiceError',
)<{
  code:
    | 'invalid_input'
    | 'not_found'
    | 'conflict'
    | 'database_error'
    | 'workflow_start_failed'
  message: string
  cause?: unknown
}>() {}

export type DecideAnalysisEnvironment = {
  HYPERDRIVE: HyperdriveConnection
  DECIDE_ANALYSIS_WORKFLOW: DecideAnalysisWorkflowBinding
}

export type StartDecideAnalysisInput = {
  env: DecideAnalysisEnvironment
  workspaceId: string
  ownerUserId: string
  threadId: string
  idempotencyKey: string
  question: string
  data?: string
  context?: string
}

export type RetryDecideAnalysisInput = {
  env: DecideAnalysisEnvironment
  workspaceId: string
  ownerUserId: string
  threadId: string
  runId: string
  retryKey: string
}

export type DecideAnalysisActor = {
  workspaceId: string
  ownerUserId: string
  threadId: string
}

const progressSchema = z.object({
  progress: z.number(),
  total: z.number().optional(),
  message: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  updatedAt: z.string(),
})

const statusSchema = z.enum(DECIDE_ANALYSIS_STATUSES)

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

const isDuplicateWorkflowError = (cause: unknown) => {
  const message = errorMessage(cause).toLowerCase()
  return (
    message.includes('already exists') ||
    message.includes('already_exists') ||
    message.includes('duplicate')
  )
}

const workflowInstanceId = (runId: string, attempt: number) =>
  `decide-analysis-${runId}-attempt-${attempt}`

const runLock = (runId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`decide-analysis:${runId}`}))`

const idempotencyLock = (workspaceId: string, idempotencyKey: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`decide-analysis:${workspaceId}:${idempotencyKey}`}))`

const ACTIVE_STATUSES = ['queued', 'running', 'cancel_requested'] as const
const ACTIVE_RUN_INDEX = 'decide_analysis_run_thread_active_idx'

/**
 * True when Postgres rejected a write because the thread already has an
 * active run. Drizzle wraps driver errors, so the pg fields can sit on the
 * error itself or on its `cause`.
 */
function isActiveRunConflict(cause: unknown): boolean {
  if (cause === null || typeof cause !== 'object') return false
  const record = cause as {
    code?: unknown
    constraint?: unknown
    cause?: unknown
  }
  if (record.code === '23505' && record.constraint === ACTIVE_RUN_INDEX) {
    return true
  }
  return isActiveRunConflict(record.cause)
}

const databaseError = (operation: string) => (cause: unknown) =>
  new DecideAnalysisServiceError({
    code: 'database_error',
    message: `Could not ${operation}: ${errorMessage(cause)}`,
    cause,
  })

/**
 * Runs one service operation on its own pg client and closes it afterwards.
 * Before, every call went through `getPooledDb`, which builds a `pg` Pool that
 * nothing closes, so a long analysis opened a new pool per progress event.
 * Now each operation owns exactly one connection for its lifetime, the same
 * request-scoped pattern `apps/web/src/lib/server/db.ts` uses. A close
 * failure cannot change the operation's outcome, so it is dropped.
 */
async function withDb<T>(
  env: DecideAnalysisEnvironment,
  operation: string,
  run: (db: Db) => Promise<T>,
): Promise<ResultValue<T, DecideAnalysisServiceError>> {
  const opened = await Result.tryPromise({
    try: () => createRuntimeDbClient(env.HYPERDRIVE),
    catch: databaseError(operation),
  })
  if (opened.isErr()) return Result.err(opened.error)
  const client = opened.value
  const result = await Result.tryPromise({
    try: () => run(client.db),
    catch: databaseError(operation),
  })
  await Result.tryPromise({ try: () => client.close(), catch: () => undefined })
  return result
}

function toStatus(value: string): DecideAnalysisStatus {
  const parsed = statusSchema.safeParse(value)
  return parsed.success ? parsed.data : 'failed'
}

function toProgress(value: unknown): DecideAnalysisProgress | null {
  const parsed = progressSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Converts the database aggregate into the stable API and chat shape.
 * Storage keeps JSON values opaque so provider result blocks can evolve without
 * coupling the database package to the MCP SDK.
 */
export function toDecideAnalysisSnapshot(
  row: typeof schema.decideAnalysisRun.$inferSelect,
): DecideAnalysisSnapshot {
  return {
    runId: row.id,
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    threadId: row.threadId,
    status: toStatus(row.status),
    attempt: row.attempt,
    progress: toProgress(row.progressJson),
    providerSessionId: row.providerSessionId,
    result: row.resultJson,
    error: row.errorJson,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
  }
}

type RunRow = typeof schema.decideAnalysisRun.$inferSelect

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const

const isTerminalStatus = (status: string) =>
  (TERMINAL_STATUSES as readonly string[]).includes(status)

const notFound = (message: string) =>
  new DecideAnalysisServiceError({ code: 'not_found', message })

const runNotFound = () => notFound('Decide analysis run not found.')

const ownsRun = (row: RunRow, actor: DecideAnalysisActor) =>
  row.workspaceId === actor.workspaceId &&
  row.ownerUserId === actor.ownerUserId &&
  row.threadId === actor.threadId

const threadKeySchema = z.uuid()

async function readRun(db: Db, input: { runId: string; attempt?: number }) {
  const [row] = await db
    .select()
    .from(schema.decideAnalysisRun)
    .where(
      input.attempt === undefined
        ? eq(schema.decideAnalysisRun.id, input.runId)
        : and(
            eq(schema.decideAnalysisRun.id, input.runId),
            eq(schema.decideAnalysisRun.attempt, input.attempt),
          ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Resolves the trusted chat thread key to a `chat_thread` row. The runtime
 * sends the ChatSubAgent facet name, which is `chat_thread.runtime_key`; for
 * an issue-linked thread that is the issue ID, not the thread ID. The old
 * lookup matched only `id`, so issue-linked chats could not start a run. An
 * exact `id` match wins, then the most recently updated `runtime_key` match.
 */
async function resolveThread(
  db: Db,
  input: { workspaceId: string; ownerUserId: string; threadKey: string },
) {
  if (!threadKeySchema.safeParse(input.threadKey).success) return null
  const [thread] = await db
    .select({
      threadId: schema.chatThread.id,
      agentId: schema.chatThread.agentId,
      agentRuntimeName: schema.agent.hostName,
    })
    .from(schema.chatThread)
    .innerJoin(schema.agent, eq(schema.agent.id, schema.chatThread.agentId))
    .where(
      and(
        or(
          eq(schema.chatThread.id, input.threadKey),
          eq(schema.chatThread.runtimeKey, input.threadKey),
        ),
        eq(schema.chatThread.workspaceId, input.workspaceId),
        eq(schema.chatThread.ownerUserId, input.ownerUserId),
      ),
    )
    .orderBy(
      desc(sql`${schema.chatThread.id} = ${input.threadKey}`),
      desc(schema.chatThread.updatedAt),
    )
    .limit(1)
  return thread ?? null
}

async function readActiveRun(db: Db, threadId: string) {
  const [row] = await db
    .select()
    .from(schema.decideAnalysisRun)
    .where(
      and(
        eq(schema.decideAnalysisRun.threadId, threadId),
        inArray(schema.decideAnalysisRun.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Picks the Decide session a follow-up continues. Only a `completed` run
 * seeds it: a failed run can leave an empty session, and continuing one made
 * Decide answer with a paid greeting instead of an analysis.
 */
async function latestCompletedSession(db: Db, threadId: string) {
  const [row] = await db
    .select({ sessionId: schema.decideAnalysisRun.providerSessionId })
    .from(schema.decideAnalysisRun)
    .where(
      and(
        eq(schema.decideAnalysisRun.threadId, threadId),
        eq(schema.decideAnalysisRun.status, 'completed'),
      ),
    )
    .orderBy(desc(schema.decideAnalysisRun.completedAt))
    .limit(1)
  return row?.sessionId ?? null
}

async function startWorkflow(env: DecideAnalysisEnvironment, row: RunRow) {
  const params: DecideAnalysisWorkflowParams = {
    runId: row.id,
    attempt: row.attempt,
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    threadId: row.threadId,
    agentRuntimeName: row.agentRuntimeName,
  }
  const result = await Result.tryPromise({
    try: async () =>
      await env.DECIDE_ANALYSIS_WORKFLOW.create({
        id: row.workflowInstanceId,
        params,
      }),
    catch: (cause) => cause,
  })
  if (
    result.isOk() ||
    (result.isErr() && isDuplicateWorkflowError(result.error))
  ) {
    return Result.ok(undefined)
  }
  const failure = new DecideAnalysisServiceError({
    code: 'workflow_start_failed',
    message: `Could not start Decide analysis workflow: ${errorMessage(result.error)}`,
    cause: result.error,
  })
  await withDb(env, 'record Decide workflow start failure', (db) =>
    db
      .update(schema.decideAnalysisRun)
      .set({
        status: 'failed',
        errorJson: decideAnalysisErrorResult(failure),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.decideAnalysisRun.id, row.id)),
  )
  return Result.err(failure)
}

/**
 * Starts one analysis for a chat thread, or returns the run that is already
 * active there. Before, every call created a run, so a model that retried
 * while it waited paid Decide twice. Now a thread has at most one active run:
 * the transaction returns the active row, and the partial unique index
 * `decide_analysis_run_thread_active_idx` catches the race where two calls
 * pass that check together. The advisory lock still collapses MCP retries
 * that share a tool-call ID.
 *
 * Garden owns the Decide session. A call without `data` continues the
 * thread's latest completed session; a call with `data` starts a new one.
 */
export async function startDecideAnalysis(
  input: StartDecideAnalysisInput,
): Promise<
  ResultValue<DecideAnalysisStartOutcome, DecideAnalysisServiceError>
> {
  const question = input.question.trim()
  const idempotencyKey = input.idempotencyKey.trim()
  if (!question || !idempotencyKey) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'invalid_input',
        message: 'A question and idempotency key are required.',
      }),
    )
  }
  const data = input.data?.trim() ? input.data : undefined
  const threadScope = {
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    threadKey: input.threadId,
  }

  const created = await withDb(input.env, 'create Decide analysis run', (db) =>
    db.transaction(async (tx) => {
      await tx.execute(idempotencyLock(input.workspaceId, idempotencyKey))
      const [existing] = await tx
        .select()
        .from(schema.decideAnalysisRun)
        .where(
          and(
            eq(schema.decideAnalysisRun.workspaceId, input.workspaceId),
            eq(schema.decideAnalysisRun.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1)
      if (existing) return { kind: 'started' as const, row: existing }

      const thread = await resolveThread(tx, threadScope)
      if (!thread) return null

      const active = await readActiveRun(tx, thread.threadId)
      if (active) return { kind: 'already_running' as const, row: active }

      const runId = crypto.randomUUID()
      const attempt = 1
      const [row] = await tx
        .insert(schema.decideAnalysisRun)
        .values({
          id: runId,
          workspaceId: input.workspaceId,
          ownerUserId: input.ownerUserId,
          threadId: thread.threadId,
          agentId: thread.agentId,
          agentRuntimeName: thread.agentRuntimeName ?? thread.agentId,
          idempotencyKey,
          workflowInstanceId: workflowInstanceId(runId, attempt),
          question,
          inputData: data ?? null,
          context: input.context ?? null,
          providerSessionId:
            data === undefined
              ? await latestCompletedSession(tx, thread.threadId)
              : null,
          status: 'queued',
          attempt,
        })
        .returning()
      return row ? { kind: 'started' as const, row } : null
    }),
  )

  const outcome = created.isErr()
    ? isActiveRunConflict(created.error)
      ? await withDb(
          input.env,
          'read active Decide analysis run',
          async (db) => {
            const thread = await resolveThread(db, threadScope)
            const active = thread
              ? await readActiveRun(db, thread.threadId)
              : null
            return active
              ? { kind: 'already_running' as const, row: active }
              : null
          },
        )
      : Result.err(created.error)
    : created
  if (outcome.isErr()) return Result.err(outcome.error)
  if (!outcome.value) return Result.err(notFound('Chat thread not found.'))

  const { kind, row } = outcome.value
  if (kind === 'started') {
    const workflowResult = await startWorkflow(input.env, row)
    if (workflowResult.isErr()) return Result.err(workflowResult.error)
  }
  return Result.ok({ kind, snapshot: toDecideAnalysisSnapshot(row) })
}

export async function getDecideAnalysis(
  env: DecideAnalysisEnvironment,
  actor: DecideAnalysisActor,
  runId: string,
): Promise<ResultValue<DecideAnalysisSnapshot, DecideAnalysisServiceError>> {
  const result = await withDb(env, 'read Decide analysis run', (db) =>
    readRun(db, { runId }),
  )
  return result.andThen((row) =>
    row !== null && ownsRun(row, actor)
      ? Result.ok(toDecideAnalysisSnapshot(row))
      : Result.err(runNotFound()),
  )
}

export async function listDecideAnalyses(
  env: DecideAnalysisEnvironment,
  actor: DecideAnalysisActor,
) {
  const result = await withDb(env, 'list Decide analysis runs', (db) =>
    db
      .select()
      .from(schema.decideAnalysisRun)
      .where(
        and(
          eq(schema.decideAnalysisRun.workspaceId, actor.workspaceId),
          eq(schema.decideAnalysisRun.ownerUserId, actor.ownerUserId),
          eq(schema.decideAnalysisRun.threadId, actor.threadId),
        ),
      )
      .orderBy(desc(schema.decideAnalysisRun.createdAt)),
  )
  return result.map((rows) => rows.map(toDecideAnalysisSnapshot))
}

/** Requests cancellation without pretending that the provider stopped. */
export async function cancelDecideAnalysis(
  env: DecideAnalysisEnvironment,
  actor: DecideAnalysisActor,
  runId: string,
): Promise<ResultValue<DecideAnalysisSnapshot, DecideAnalysisServiceError>> {
  const result = await withDb(env, 'cancel Decide analysis run', (db) =>
    db.transaction(async (tx) => {
      await tx.execute(runLock(runId))
      const row = await readRun(tx, { runId })
      if (!row || !ownsRun(row, actor)) return null
      if (row.status === 'queued') {
        const [cancelled] = await tx
          .update(schema.decideAnalysisRun)
          .set({ status: 'cancelled', completedAt: new Date() })
          .where(eq(schema.decideAnalysisRun.id, row.id))
          .returning()
        return cancelled ?? row
      }
      if (row.status === 'running') {
        const [requested] = await tx
          .update(schema.decideAnalysisRun)
          .set({ status: 'cancel_requested', cancelRequestedAt: new Date() })
          .where(eq(schema.decideAnalysisRun.id, row.id))
          .returning()
        return requested ?? row
      }
      return row
    }),
  )
  return result.andThen((row) =>
    row ? Result.ok(toDecideAnalysisSnapshot(row)) : Result.err(runNotFound()),
  )
}

/**
 * Creates a new attempt while keeping the public run ID stable. A retry while
 * another run is active in the thread hits the active-run index and returns a
 * conflict instead of starting a second paid analysis.
 */
export async function retryDecideAnalysis(
  input: RetryDecideAnalysisInput,
): Promise<ResultValue<DecideAnalysisSnapshot, DecideAnalysisServiceError>> {
  const retryKey = input.retryKey.trim()
  if (!retryKey) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'invalid_input',
        message: 'A retry idempotency key is required.',
      }),
    )
  }
  const conflict = (message: string) =>
    new DecideAnalysisServiceError({ code: 'conflict', message })
  const result = await withDb(input.env, 'retry Decide analysis run', (db) =>
    db.transaction(async (tx) => {
      await tx.execute(runLock(input.runId))
      const row = await readRun(tx, { runId: input.runId })
      if (!row || !ownsRun(row, input)) return null
      if (row.retryKey === retryKey) return row
      if (row.status !== 'failed' && row.status !== 'cancelled') return row

      const attempt = row.attempt + 1
      const [updated] = await tx
        .update(schema.decideAnalysisRun)
        .set({
          status: 'queued',
          attempt,
          workflowInstanceId: workflowInstanceId(row.id, attempt),
          retryKey,
          progressSequence: 0,
          progressJson: null,
          resultJson: null,
          errorJson: null,
          providerSessionId: null,
          cancelRequestedAt: null,
          providerCallStartedAt: null,
          startedAt: null,
          completedAt: null,
          deliveredAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.decideAnalysisRun.id, row.id))
        .returning()
      return updated ?? row
    }),
  )
  if (result.isErr()) {
    return Result.err(
      isActiveRunConflict(result.error)
        ? conflict('Another Decide analysis is already running in this chat.')
        : result.error,
    )
  }
  const row = result.value
  if (!row) return Result.err(runNotFound())
  if (row.status !== 'queued' || row.retryKey !== retryKey) {
    return Result.err(
      conflict('Only failed or cancelled Decide analysis runs can retry.'),
    )
  }
  const workflowResult = await startWorkflow(input.env, row)
  if (workflowResult.isErr()) return Result.err(workflowResult.error)
  return Result.ok(toDecideAnalysisSnapshot(row))
}

export async function claimDecideAnalysisRun(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt: number },
) {
  const result = await withDb(env, 'claim Decide analysis run', (db) =>
    db.transaction(async (tx) => {
      await tx.execute(runLock(input.runId))
      const row = await readRun(tx, input)
      if (!row) return null
      if (row.status === 'queued') {
        const [running] = await tx
          .update(schema.decideAnalysisRun)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(schema.decideAnalysisRun.id, input.runId))
          .returning()
        return running ?? row
      }
      return row
    }),
  )
  return result.andThen((row) =>
    row ? Result.ok(row) : Result.err(runNotFound()),
  )
}

export async function readDecideAnalysisForWorker(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt: number },
) {
  const result = await withDb(env, 'read Decide analysis worker state', (db) =>
    readRun(db, input),
  )
  return result.andThen((row) =>
    row ? Result.ok(row) : Result.err(runNotFound()),
  )
}

export async function markDecideAnalysisProviderStarted(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt: number },
) {
  const result = await withDb(env, 'mark Decide provider call', (db) =>
    db.transaction(async (tx) => {
      await tx.execute(runLock(input.runId))
      const row = await readRun(tx, input)
      if (!row) return null
      if (isTerminalStatus(row.status)) {
        return { kind: 'terminal' as const, row }
      }
      if (row.cancelRequestedAt || row.status === 'cancel_requested') {
        return { kind: 'cancel_requested' as const, row }
      }
      if (row.providerCallStartedAt) {
        return { kind: 'uncertain' as const, row }
      }
      const [started] = await tx
        .update(schema.decideAnalysisRun)
        .set({ providerCallStartedAt: new Date() })
        .where(eq(schema.decideAnalysisRun.id, input.runId))
        .returning()
      return { kind: 'execute' as const, row: started ?? row }
    }),
  )
  return result.andThen((marker) =>
    marker ? Result.ok(marker) : Result.err(runNotFound()),
  )
}

export async function writeDecideAnalysisProgress(
  env: DecideAnalysisEnvironment,
  input: {
    runId: string
    attempt: number
    progress: Omit<DecideAnalysisProgress, 'sequence' | 'updatedAt'>
  },
) {
  return await withDb(env, 'save Decide analysis progress', (db) =>
    db.transaction(async (tx) => {
      await tx.execute(runLock(input.runId))
      const [row] = await tx
        .select({
          status: schema.decideAnalysisRun.status,
          sequence: schema.decideAnalysisRun.progressSequence,
        })
        .from(schema.decideAnalysisRun)
        .where(
          and(
            eq(schema.decideAnalysisRun.id, input.runId),
            eq(schema.decideAnalysisRun.attempt, input.attempt),
          ),
        )
        .limit(1)
      if (!row || isTerminalStatus(row.status)) return null
      const sequence = row.sequence + 1
      const progress: DecideAnalysisProgress = {
        ...input.progress,
        sequence,
        updatedAt: new Date().toISOString(),
      }
      await tx
        .update(schema.decideAnalysisRun)
        .set({
          progressSequence: sequence,
          progressJson: progress,
          updatedAt: new Date(),
        })
        .where(eq(schema.decideAnalysisRun.id, input.runId))
      return progress
    }),
  )
}

export async function finishDecideAnalysis(
  env: DecideAnalysisEnvironment,
  input: {
    runId: string
    attempt: number
    result?: unknown
    error?: unknown
    providerSessionId?: string | null
  },
) {
  const result = await withDb(env, 'finish Decide analysis run', (db) =>
    db.transaction(async (tx) => {
      await tx.execute(runLock(input.runId))
      const row = await readRun(tx, input)
      if (!row) return null
      if (isTerminalStatus(row.status)) return row
      const cancelled =
        row.status === 'cancel_requested' || row.cancelRequestedAt !== null
      const nextStatus = cancelled
        ? 'cancelled'
        : input.error === undefined
          ? 'completed'
          : 'failed'
      const [finished] = await tx
        .update(schema.decideAnalysisRun)
        .set({
          status: nextStatus,
          ...(input.result === undefined ? {} : { resultJson: input.result }),
          ...(input.error === undefined ? {} : { errorJson: input.error }),
          ...(input.providerSessionId === undefined
            ? {}
            : { providerSessionId: input.providerSessionId }),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.decideAnalysisRun.id, input.runId))
        .returning()
      return finished ?? row
    }),
  )
  return result.map((row) => (row ? toDecideAnalysisSnapshot(row) : null))
}

/**
 * Records that the chat accepted this attempt's result. The update is
 * conditional on a completed or failed run with no earlier delivery, so a
 * replayed Workflow step leaves the first timestamp in place.
 */
export async function markDecideAnalysisDelivered(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt: number },
) {
  const result = await withDb(env, 'record Decide analysis delivery', (db) =>
    db
      .update(schema.decideAnalysisRun)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          eq(schema.decideAnalysisRun.id, input.runId),
          eq(schema.decideAnalysisRun.attempt, input.attempt),
          inArray(schema.decideAnalysisRun.status, ['completed', 'failed']),
          isNull(schema.decideAnalysisRun.deliveredAt),
        ),
      ),
  )
  return result.map(() => undefined)
}

export function decideAnalysisErrorResult(error: DecideAnalysisServiceError) {
  return {
    code: error.code,
    message: error.message,
  }
}
