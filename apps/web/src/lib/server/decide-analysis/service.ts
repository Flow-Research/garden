import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type {
  DecideAnalysisOwner,
  DecideAnalysisProgress,
  DecideAnalysisSnapshot,
  DecideAnalysisSource,
  DecideAnalysisStartOutcome,
  DecideAnalysisStatus,
  DecideAnalysisWorkflowBinding,
  DecideAnalysisWorkflowParams,
} from '@garden/agent-runtime/src/decide-analysis-types'
import { DECIDE_ANALYSIS_STATUSES } from '@garden/agent-runtime/src/decide-analysis-types'
import { decideGeneratedFiles } from '@garden/agent-runtime/src/decide-analysis-result'
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
    | 'source_unavailable'
    | 'input_too_large'
  message: string
  cause?: unknown
}>() {}

export type DecideAnalysisEnvironment = {
  HYPERDRIVE: HyperdriveConnection
  DECIDE_ANALYSIS_WORKFLOW: DecideAnalysisWorkflowBinding
}

/**
 * Decide accepts inputs up to 100 MB (confirmed with Decide, 2026-11-03).
 * Counted in UTF-8 bytes, decimal megabytes, so Garden never sends more than
 * Decide documents.
 */
export const DECIDE_ANALYSIS_INPUT_LIMIT_BYTES = 100 * 1000 * 1000

/** Reads a typed source to the full text Decide analyzes. */
export type DecideAnalysisSourceReader = (request: {
  workspaceId: string
  ownerUserId: string
  source: DecideAnalysisSource
}) => Promise<ResultValue<string, DecideAnalysisServiceError>>

/**
 * The data a start sends to Decide. `text` is pasted data. `source` names a
 * file Garden reads itself, so the model never copies file contents into the
 * call. Omitted means a follow-up that continues the owner's latest
 * completed Decide session.
 */
export type DecideAnalysisInputData =
  | { kind: 'text'; text: string }
  | {
      kind: 'source'
      source: DecideAnalysisSource
      read: DecideAnalysisSourceReader
    }

/**
 * A chat owner's `threadId` is the trusted thread key from the runtime
 * (`chat_thread.id` or its `runtime_key`); the service resolves it to the row.
 */
export type StartDecideAnalysisInput = {
  env: DecideAnalysisEnvironment
  workspaceId: string
  ownerUserId: string
  owner: DecideAnalysisOwner
  idempotencyKey: string
  question: string
  input?: DecideAnalysisInputData
  context?: string
}

export type DecideAnalysisActor = {
  workspaceId: string
  ownerUserId: string
  owner: DecideAnalysisOwner
}

export type RetryDecideAnalysisInput = DecideAnalysisActor & {
  env: DecideAnalysisEnvironment
  runId: string
  retryKey: string
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

const ACTIVE_STATUSES = ['queued', 'running', 'cancel_requested'] as const
const ACTIVE_RUN_INDEXES: readonly unknown[] = [
  'decide_analysis_run_chat_active_idx',
  'decide_analysis_run_automation_run_active_idx',
]

/**
 * True when Postgres rejected a write because the owner already has an
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
  if (
    record.code === '23505' &&
    ACTIVE_RUN_INDEXES.includes(record.constraint)
  ) {
    return true
  }
  return isActiveRunConflict(record.cause)
}

/**
 * Drizzle wraps driver errors as "Failed query: <sql> params: <values>", which
 * hid the Postgres reason when a Decide run insert failed on dev. This keeps
 * the Postgres code, constraint and message from the cause chain instead, and
 * drops the SQL and params, which also kept user data out of the error.
 */
export function describeDatabaseError(cause: unknown): string {
  const seen = new Set<unknown>()
  let current: unknown = cause
  while (
    current !== null &&
    typeof current === 'object' &&
    !seen.has(current)
  ) {
    seen.add(current)
    const record = current as {
      code?: unknown
      constraint?: unknown
      message?: unknown
      cause?: unknown
    }
    if (typeof record.code === 'string' && /^[0-9A-Z]{5}$/.test(record.code)) {
      const constraint =
        typeof record.constraint === 'string' ? ` on ${record.constraint}` : ''
      return `Postgres ${record.code}${constraint}: ${String(record.message)}`
    }
    current = record.cause
  }
  return errorMessage(cause)
}

const databaseError = (operation: string) => (cause: unknown) =>
  new DecideAnalysisServiceError({
    code: 'database_error',
    message: `Could not ${operation}: ${describeDatabaseError(cause)}`,
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
  await Result.tryPromise({
    try: () => client.close(),
    catch: () => undefined,
  })
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
 * Reads the typed owner back from the row. `decide_analysis_run_owner_check`
 * guarantees a row without `automation_run_id` is a chat run with a thread.
 */
function ownerOf(row: {
  threadId: string | null
  automationRunId: string | null
}): DecideAnalysisOwner {
  return row.automationRunId !== null
    ? { kind: 'automation_run', automationRunId: row.automationRunId }
    : { kind: 'chat', threadId: row.threadId as string }
}

/** The run columns that store one owner, for inserts. */
function ownerColumns(owner: DecideAnalysisOwner) {
  return owner.kind === 'chat'
    ? { ownerKind: owner.kind, threadId: owner.threadId, automationRunId: null }
    : {
        ownerKind: owner.kind,
        threadId: null,
        automationRunId: owner.automationRunId,
      }
}

/** Matches the runs of one owner. */
function ownedBy(owner: DecideAnalysisOwner) {
  return owner.kind === 'chat'
    ? eq(schema.decideAnalysisRun.threadId, owner.threadId)
    : eq(schema.decideAnalysisRun.automationRunId, owner.automationRunId)
}

const sameOwner = (a: DecideAnalysisOwner, b: DecideAnalysisOwner) =>
  a.kind === 'chat'
    ? b.kind === 'chat' && a.threadId === b.threadId
    : b.kind === 'automation_run' && a.automationRunId === b.automationRunId

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
    owner: ownerOf(row),
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

/**
 * The run fields the browser may read. The status routes returned the whole
 * snapshot, which sent Decide's raw result blocks and the provider session ID
 * to the client. The answer reaches the user as a chat turn, so the API keeps
 * lifecycle state plus the generated files, parsed here once so the chat
 * renders them as file cards instead of trusting model-written links.
 */
export function toPublicDecideAnalysis(snapshot: DecideAnalysisSnapshot) {
  return {
    files:
      snapshot.status === 'completed'
        ? decideGeneratedFiles(snapshot.result)
        : [],
    runId: snapshot.runId,
    status: snapshot.status,
    attempt: snapshot.attempt,
    progress: snapshot.progress,
    error: snapshot.error,
    createdAt: snapshot.createdAt,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
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
  sameOwner(ownerOf(row), actor.owner)

const ownerIdSchema = z.uuid()

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
  if (!ownerIdSchema.safeParse(input.threadKey).success) return null
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

/**
 * Resolves an automation run inside the caller's workspace to the agent that
 * runs it, so its Decide run is attributed to the same AgentDO runtime.
 */
async function resolveAutomationRun(
  db: Db,
  input: { workspaceId: string; automationRunId: string },
) {
  if (!ownerIdSchema.safeParse(input.automationRunId).success) return null
  const [run] = await db
    .select({
      agentId: schema.automationRun.agentId,
      agentRuntimeName: schema.automationRun.hostName,
    })
    .from(schema.automationRun)
    .where(
      and(
        eq(schema.automationRun.id, input.automationRunId),
        eq(schema.automationRun.workspaceId, input.workspaceId),
      ),
    )
    .limit(1)
  return run ?? null
}

/**
 * Resolves a start's owner to a stored owner plus the agent runtime that
 * receives the result. Before, only chat threads could own a run; now an
 * automation run in the same workspace can too. Returns null when the owner
 * is not visible to the caller.
 */
async function resolveOwner(
  db: Db,
  input: {
    workspaceId: string
    ownerUserId: string
    owner: DecideAnalysisOwner
  },
): Promise<{
  owner: DecideAnalysisOwner
  agentId: string
  agentRuntimeName: string
} | null> {
  if (input.owner.kind === 'automation_run') {
    const run = await resolveAutomationRun(db, {
      workspaceId: input.workspaceId,
      automationRunId: input.owner.automationRunId,
    })
    return run ? { owner: input.owner, ...run } : null
  }
  const thread = await resolveThread(db, {
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    threadKey: input.owner.threadId,
  })
  return thread
    ? {
        owner: { kind: 'chat', threadId: thread.threadId },
        agentId: thread.agentId,
        agentRuntimeName: thread.agentRuntimeName ?? thread.agentId,
      }
    : null
}

async function readActiveRun(db: Db, owner: DecideAnalysisOwner) {
  const [row] = await db
    .select()
    .from(schema.decideAnalysisRun)
    .where(
      and(
        ownedBy(owner),
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
async function latestCompletedSession(db: Db, owner: DecideAnalysisOwner) {
  const [row] = await db
    .select({ sessionId: schema.decideAnalysisRun.providerSessionId })
    .from(schema.decideAnalysisRun)
    .where(
      and(ownedBy(owner), eq(schema.decideAnalysisRun.status, 'completed')),
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
    owner: ownerOf(row),
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
 * Tool error for a Decide start that has no data and no earlier completed
 * session in the thread. The chat model relays it, so it asks the user for
 * the file in plain words.
 */
export const DECIDE_ANALYSIS_NEEDS_DATA_MESSAGE =
  'There is no data to analyze yet. Ask the user to attach the file or paste the data they want Decide to analyze. No earlier Decide analysis in this chat can be continued.'

/**
 * Counts UTF-8 bytes without encoding when the answer is already known: a
 * UTF-16 code unit encodes to between one and three UTF-8 bytes.
 */
export function exceedsInputLimit(text: string) {
  if (text.length > DECIDE_ANALYSIS_INPUT_LIMIT_BYTES) return true
  if (text.length * 3 <= DECIDE_ANALYSIS_INPUT_LIMIT_BYTES) return false
  return (
    new TextEncoder().encode(text).byteLength >
    DECIDE_ANALYSIS_INPUT_LIMIT_BYTES
  )
}

/**
 * Turns a start's input into the text stored in `input_data`. Before, the
 * only input was text the model pasted, so a large sheet passed through the
 * model and could be cut or summarised. A `source` is now read by Garden.
 * Pasted and read text both get the 100 MB check here, so neither path can
 * start an analysis Decide would refuse.
 */
async function resolveInputText(
  input: StartDecideAnalysisInput,
): Promise<ResultValue<string | undefined, DecideAnalysisServiceError>> {
  const read: ResultValue<string | undefined, DecideAnalysisServiceError> =
    input.input === undefined
      ? Result.ok(undefined)
      : input.input.kind === 'text'
        ? Result.ok(input.input.text)
        : await input.input.read({
            workspaceId: input.workspaceId,
            ownerUserId: input.ownerUserId,
            source: input.input.source,
          })
  return read.andThen((text) => {
    if (text !== undefined && exceedsInputLimit(text)) {
      return Result.err(
        new DecideAnalysisServiceError({
          code: 'input_too_large',
          message:
            'The data is larger than the 100 MB Decide accepts. Ask the user for a smaller file or a filtered export.',
        }),
      )
    }
    if (text?.trim()) return Result.ok(text)
    // An empty file must not fall through to a follow-up that silently
    // continues an earlier session.
    return input.input?.kind === 'source'
      ? Result.err(
          new DecideAnalysisServiceError({
            code: 'source_unavailable',
            message: 'The selected file has no text to analyze.',
          }),
        )
      : Result.ok(undefined)
  })
}

/**
 * Starts one analysis for an owner (a chat thread or an automation run), or
 * returns the run that is already active for that owner. Before, every call
 * created a run, so a model that retried while it waited paid Decide twice.
 * Now an owner has at most one active run: the transaction returns the active
 * row, and the per-owner partial unique indexes
 * (`decide_analysis_run_chat_active_idx`,
 * `decide_analysis_run_automation_run_active_idx`) catch the race where two
 * calls pass that check together. A retried MCP call lands on that same
 * active row, so it needs no key lookup.
 *
 * The tool-call ID is stored for tracing only. Before, a workspace-wide
 * lookup by that ID returned any earlier run with the same ID, and model
 * tool-call IDs repeat (`functions.tool_executor_decide_analyze:1` restarts in
 * every thread), so a new chat got another chat's finished run and nothing
 * ran. Now only the owner's active run is ever returned.
 *
 * Garden owns the Decide session. A call without input continues the
 * owner's latest completed session; a call with input starts a new one.
 *
 * A `source` is read and every input is size-checked before the transaction
 * opens, so a file read never holds a database transaction and an oversized
 * input never creates a run or starts a paid analysis.
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
  const resolvedText = await resolveInputText(input)
  if (resolvedText.isErr()) return Result.err(resolvedText.error)
  const data = resolvedText.value
  const ownerScope = {
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    owner: input.owner,
  }

  const created = await withDb(input.env, 'create Decide analysis run', (db) =>
    db.transaction(async (tx) => {
      const resolved = await resolveOwner(tx, ownerScope)
      if (!resolved) return null

      const active = await readActiveRun(tx, resolved.owner)
      if (active) return { kind: 'already_running' as const, row: active }

      // A follow-up without data continues the owner's last completed
      // Decide session. With no such session, Decide has nothing to analyze
      // and answers with a paid greeting, so the start is refused instead.
      const providerSessionId =
        data === undefined
          ? await latestCompletedSession(tx, resolved.owner)
          : null
      if (data === undefined && providerSessionId === null) {
        return { kind: 'needs_data' as const }
      }

      const runId = crypto.randomUUID()
      const attempt = 1
      const [row] = await tx
        .insert(schema.decideAnalysisRun)
        .values({
          id: runId,
          workspaceId: input.workspaceId,
          ownerUserId: input.ownerUserId,
          ...ownerColumns(resolved.owner),
          agentId: resolved.agentId,
          agentRuntimeName: resolved.agentRuntimeName,
          idempotencyKey,
          workflowInstanceId: workflowInstanceId(runId, attempt),
          question,
          inputData: data ?? null,
          context: input.context ?? null,
          providerSessionId,
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
            const resolved = await resolveOwner(db, ownerScope)
            const active = resolved
              ? await readActiveRun(db, resolved.owner)
              : null
            return active
              ? { kind: 'already_running' as const, row: active }
              : null
          },
        )
      : Result.err(created.error)
    : created
  if (outcome.isErr()) return Result.err(outcome.error)
  if (!outcome.value) {
    return Result.err(
      notFound(
        input.owner.kind === 'chat'
          ? 'Chat thread not found.'
          : 'Automation run not found.',
      ),
    )
  }
  if (outcome.value.kind === 'needs_data') {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'invalid_input',
        message: DECIDE_ANALYSIS_NEEDS_DATA_MESSAGE,
      }),
    )
  }

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
          ownedBy(actor.owner),
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
 * another run is active for the owner hits the active-run index and returns a
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
        ? conflict(
            input.owner.kind === 'chat'
              ? 'Another Decide analysis is already running in this chat.'
              : 'Another Decide analysis is already running for this automation run.',
          )
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
