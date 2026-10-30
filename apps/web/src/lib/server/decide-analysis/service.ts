import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type {
  DecideAnalysisProgress,
  DecideAnalysisSnapshot,
  DecideAnalysisStatus,
  DecideAnalysisWorkflowBinding,
  DecideAnalysisWorkflowParams,
} from '@garden/agent-runtime'
import { DECIDE_ANALYSIS_STATUSES } from '@garden/agent-runtime'
import { getPooledDb } from '@garden/db/runtime'
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
  providerSessionId?: string
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
  `decide-analysis:${runId}:attempt:${attempt}`

const runLock = (runId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`decide-analysis:${runId}`}))`

const idempotencyLock = (workspaceId: string, idempotencyKey: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`decide-analysis:${workspaceId}:${idempotencyKey}`}))`

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
  }
}

async function readRun(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt?: number },
) {
  const db = getPooledDb(env.HYPERDRIVE.connectionString)
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

async function startWorkflow(
  env: DecideAnalysisEnvironment,
  row: typeof schema.decideAnalysisRun.$inferSelect,
) {
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
  await Result.tryPromise({
    try: async () => {
      const db = getPooledDb(env.HYPERDRIVE.connectionString)
      await db
        .update(schema.decideAnalysisRun)
        .set({
          status: 'failed',
          errorJson: decideAnalysisErrorResult(failure),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.decideAnalysisRun.id, row.id))
    },
    catch: () => undefined,
  })
  return Result.err(failure)
}

/**
 * Creates or reuses one logical analysis run, then starts its deterministic
 * Workflow instance. The advisory lock closes the race where two MCP retries
 * use the same tool-call ID at the same time.
 */
export async function startDecideAnalysis(
  input: StartDecideAnalysisInput,
): Promise<ResultValue<DecideAnalysisSnapshot, DecideAnalysisServiceError>> {
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

  const db = getPooledDb(input.env.HYPERDRIVE.connectionString)
  const transactionResult = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
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
        if (existing) return existing

        const [thread] = await tx
          .select({
            threadId: schema.chatThread.id,
            agentId: schema.chatThread.agentId,
            agentRuntimeName: schema.agent.hostName,
          })
          .from(schema.chatThread)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.chatThread.agentId),
          )
          .where(
            and(
              eq(schema.chatThread.id, input.threadId),
              eq(schema.chatThread.workspaceId, input.workspaceId),
              eq(schema.chatThread.ownerUserId, input.ownerUserId),
            ),
          )
          .limit(1)
        if (!thread) return null

        const runId = crypto.randomUUID()
        const attempt = 1
        const [created] = await tx
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
            inputData: input.data ?? null,
            context: input.context ?? null,
            providerSessionId: input.providerSessionId ?? null,
            status: 'queued',
            attempt,
          })
          .returning()
        return created ?? null
      }),
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not create Decide analysis run: ${errorMessage(cause)}`,
        cause,
      }),
  })

  if (transactionResult.isErr()) {
    return Result.err(transactionResult.error)
  }
  if (!transactionResult.value) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'not_found',
        message: 'Chat thread not found.',
      }),
    )
  }

  const workflowResult = await startWorkflow(input.env, transactionResult.value)
  if (workflowResult.isErr()) return Result.err(workflowResult.error)
  return Result.ok(toDecideAnalysisSnapshot(transactionResult.value))
}

export async function getDecideAnalysis(
  env: DecideAnalysisEnvironment,
  actor: DecideAnalysisActor,
  runId: string,
): Promise<ResultValue<DecideAnalysisSnapshot, DecideAnalysisServiceError>> {
  const result = await Result.tryPromise({
    try: async () => await readRun(env, { runId }),
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not read Decide analysis run: ${errorMessage(cause)}`,
        cause,
      }),
  })
  if (result.isErr()) return Result.err(result.error)
  const row = result.value
  if (
    row === null ||
    row.workspaceId !== actor.workspaceId ||
    row.ownerUserId !== actor.ownerUserId ||
    row.threadId !== actor.threadId
  ) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'not_found',
        message: 'Decide analysis run not found.',
      }),
    )
  }
  return Result.ok(toDecideAnalysisSnapshot(row))
}

export async function listDecideAnalyses(
  env: DecideAnalysisEnvironment,
  actor: DecideAnalysisActor,
) {
  const result = await Result.tryPromise({
    try: async () => {
      const db = getPooledDb(env.HYPERDRIVE.connectionString)
      return await db
        .select()
        .from(schema.decideAnalysisRun)
        .where(
          and(
            eq(schema.decideAnalysisRun.workspaceId, actor.workspaceId),
            eq(schema.decideAnalysisRun.ownerUserId, actor.ownerUserId),
            eq(schema.decideAnalysisRun.threadId, actor.threadId),
          ),
        )
        .orderBy(desc(schema.decideAnalysisRun.createdAt))
    },
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not list Decide analysis runs: ${errorMessage(cause)}`,
        cause,
      }),
  })
  return result.map((rows) => rows.map(toDecideAnalysisSnapshot))
}

/** Requests cancellation without pretending that the provider stopped. */
export async function cancelDecideAnalysis(
  env: DecideAnalysisEnvironment,
  actor: DecideAnalysisActor,
  runId: string,
): Promise<ResultValue<DecideAnalysisSnapshot, DecideAnalysisServiceError>> {
  const result = await Result.tryPromise({
    try: async () => {
      const db = getPooledDb(env.HYPERDRIVE.connectionString)
      return await db.transaction(async (tx) => {
        await tx.execute(runLock(runId))
        const [row] = await tx
          .select()
          .from(schema.decideAnalysisRun)
          .where(eq(schema.decideAnalysisRun.id, runId))
          .limit(1)
        if (!row) return null
        if (
          row.workspaceId !== actor.workspaceId ||
          row.ownerUserId !== actor.ownerUserId ||
          row.threadId !== actor.threadId
        ) {
          return null
        }
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
      })
    },
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not cancel Decide analysis run: ${errorMessage(cause)}`,
        cause,
      }),
  })
  if (result.isErr()) return Result.err(result.error)
  if (!result.value) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'not_found',
        message: 'Decide analysis run not found.',
      }),
    )
  }
  return Result.ok(toDecideAnalysisSnapshot(result.value))
}

/** Creates a new attempt while keeping the public run ID stable. */
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
  const db = getPooledDb(input.env.HYPERDRIVE.connectionString)
  const result = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
        await tx.execute(runLock(input.runId))
        const [row] = await tx
          .select()
          .from(schema.decideAnalysisRun)
          .where(eq(schema.decideAnalysisRun.id, input.runId))
          .limit(1)
        if (!row) return null
        if (
          row.workspaceId !== input.workspaceId ||
          row.ownerUserId !== input.ownerUserId ||
          row.threadId !== input.threadId
        ) {
          return null
        }
        if (row.retryKey === retryKey) return row
        if (row.status !== 'failed' && row.status !== 'cancelled') return row

        const attempt = row.attempt + 1
        const [updated] = await tx
          .update(schema.decideAnalysisRun)
          .set({
            status: 'queued',
            attempt,
            workflowInstanceId: workflowInstanceId(row.id, attempt),
            idempotencyKey: `${row.id}:${retryKey}`,
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
            updatedAt: new Date(),
          })
          .where(eq(schema.decideAnalysisRun.id, row.id))
          .returning()
        return updated ?? row
      }),
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not retry Decide analysis run: ${errorMessage(cause)}`,
        cause,
      }),
  })
  if (result.isErr()) return Result.err(result.error)
  if (!result.value) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'not_found',
        message: 'Decide analysis run not found.',
      }),
    )
  }
  if (result.value.status !== 'queued' || result.value.retryKey !== retryKey) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'conflict',
        message: 'Only failed or cancelled Decide analysis runs can retry.',
      }),
    )
  }
  const workflowResult = await startWorkflow(input.env, result.value)
  if (workflowResult.isErr()) return Result.err(workflowResult.error)
  return Result.ok(toDecideAnalysisSnapshot(result.value))
}

export async function claimDecideAnalysisRun(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt: number },
) {
  const result = await Result.tryPromise({
    try: async () => {
      const db = getPooledDb(env.HYPERDRIVE.connectionString)
      return await db.transaction(async (tx) => {
        await tx.execute(runLock(input.runId))
        const [row] = await tx
          .select()
          .from(schema.decideAnalysisRun)
          .where(
            and(
              eq(schema.decideAnalysisRun.id, input.runId),
              eq(schema.decideAnalysisRun.attempt, input.attempt),
            ),
          )
          .limit(1)
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
      })
    },
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not claim Decide analysis run: ${errorMessage(cause)}`,
        cause,
      }),
  })
  if (result.isErr()) return result
  if (!result.value) {
    return Result.err(
      new DecideAnalysisServiceError({
        code: 'not_found',
        message: 'Decide analysis run not found.',
      }),
    )
  }
  return Result.ok(result.value)
}

export async function readDecideAnalysisForWorker(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt: number },
) {
  const result = await Result.tryPromise({
    try: async () => await readRun(env, input),
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not read Decide analysis worker state: ${errorMessage(cause)}`,
        cause,
      }),
  })
  if (result.isErr()) return result
  return result.value
    ? Result.ok(result.value)
    : Result.err(
        new DecideAnalysisServiceError({
          code: 'not_found',
          message: 'Decide analysis run not found.',
        }),
      )
}

export async function markDecideAnalysisProviderStarted(
  env: DecideAnalysisEnvironment,
  input: { runId: string; attempt: number },
) {
  const result = await Result.tryPromise({
    try: async () => {
      const db = getPooledDb(env.HYPERDRIVE.connectionString)
      return await db.transaction(async (tx) => {
        await tx.execute(runLock(input.runId))
        const [row] = await tx
          .select()
          .from(schema.decideAnalysisRun)
          .where(
            and(
              eq(schema.decideAnalysisRun.id, input.runId),
              eq(schema.decideAnalysisRun.attempt, input.attempt),
            ),
          )
          .limit(1)
        if (!row) return null
        if (
          row.status === 'completed' ||
          row.status === 'failed' ||
          row.status === 'cancelled'
        ) {
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
      })
    },
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not mark Decide provider call: ${errorMessage(cause)}`,
        cause,
      }),
  })
  if (result.isErr()) return result
  return result.value
    ? Result.ok(result.value)
    : Result.err(
        new DecideAnalysisServiceError({
          code: 'not_found',
          message: 'Decide analysis run not found.',
        }),
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
  const result = await Result.tryPromise({
    try: async () => {
      const db = getPooledDb(env.HYPERDRIVE.connectionString)
      return await db.transaction(async (tx) => {
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
        if (
          !row ||
          row.status === 'completed' ||
          row.status === 'failed' ||
          row.status === 'cancelled'
        ) {
          return null
        }
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
      })
    },
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not save Decide analysis progress: ${errorMessage(cause)}`,
        cause,
      }),
  })
  return result
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
  const result = await Result.tryPromise({
    try: async () => {
      const db = getPooledDb(env.HYPERDRIVE.connectionString)
      return await db.transaction(async (tx) => {
        await tx.execute(runLock(input.runId))
        const [row] = await tx
          .select()
          .from(schema.decideAnalysisRun)
          .where(
            and(
              eq(schema.decideAnalysisRun.id, input.runId),
              eq(schema.decideAnalysisRun.attempt, input.attempt),
            ),
          )
          .limit(1)
        if (!row) return null
        if (
          row.status === 'completed' ||
          row.status === 'failed' ||
          row.status === 'cancelled'
        ) {
          return row
        }
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
      })
    },
    catch: (cause) =>
      new DecideAnalysisServiceError({
        code: 'database_error',
        message: `Could not finish Decide analysis run: ${errorMessage(cause)}`,
        cause,
      }),
  })
  return result.map((row) => (row ? toDecideAnalysisSnapshot(row) : null))
}

export function decideAnalysisErrorResult(error: DecideAnalysisServiceError) {
  return {
    code: error.code,
    message: error.message,
  }
}
