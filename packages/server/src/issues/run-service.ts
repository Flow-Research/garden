import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { getPooledDb } from '@garden/db/runtime'
import type {
  IssueRun,
  IssueRunEvent,
  IssueRunStatus,
  IssueRunTriggerSource,
  IssueStatus,
  IssueWorkProduct,
} from '@garden/core/types'
import {
  canResumeWaitingRun,
  LIVE_RUN_STATUSES,
  shouldSkipIssueRunStart,
} from '@garden/core/issues/run-sync'
import * as schema from '@garden/db/schema'

const WORKFLOW_START_FAILURE_RETRY_DELAY_MS = 5_000
const AGENT_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/
const RUN_WORKFLOW_CONTROL_EVENT_TYPE = 'run-control'

type RunWorkflowControlEvent = { kind: 'resume' | 'cancel' }

type RunWorkflowBinding = {
  get: (id: string) => Promise<{
    sendEvent: (event: {
      type: typeof RUN_WORKFLOW_CONTROL_EVENT_TYPE
      payload: RunWorkflowControlEvent
    }) => Promise<void>
  }>
}

function isIssueRunAgentRuntimeName(value: string) {
  return AGENT_RUNTIME_NAME_PATTERN.test(value)
}

export class IssueRunServiceError extends TaggedError('IssueRunServiceError')<{
  code:
    | 'issue_not_found'
    | 'agent_not_found'
    | 'run_not_found'
    | 'runtime_error'
    | 'db_error'
  message: string
  cause?: unknown
}>() {}

export type StartIssueRunInput = {
  workspaceId: string
  issueId: string
  agentId: string
  source: IssueRunTriggerSource
  trigger?: {
    commentId?: string
    sourceBindingId?: string
    correlationId?: string
  }
  actor: { type: 'member' | 'agent' | 'system'; id: string }
}

/**
 * Minimal structural shape of the Cloudflare Hyperdrive binding this package
 * consumes. `@garden/server` does not pull in `@cloudflare/workers-types` as an
 * ambient global, and the run service only reads `connectionString`. Workers
 * (web app, agent runtime) pass the full global `Hyperdrive` binding here, which
 * is structurally assignable to this narrower type.
 */
type HyperdriveConnection = { readonly connectionString: string }

export type IssueRunEnv = {
  HYPERDRIVE: HyperdriveConnection
  RUN_WORKFLOW?: RunWorkflowBinding
  AgentDO?: {
    idFromName: (name: string) => any
    get: (id: any) => {
      startIssueRunWorkflow: (input: {
        runId: string
        issueId: string
      }) => Promise<void>
      cancelIssueRun: (input: {
        runId: string
        issueId: string
      }) => Promise<void>
    }
  }
}

function getIssueRunAgentDoStub(
  env: IssueRunEnv,
  agentRuntimeName: string,
): ResultValue<
  ReturnType<NonNullable<IssueRunEnv['AgentDO']>['get']>,
  IssueRunServiceError
> {
  if (!agentRuntimeName || !isIssueRunAgentRuntimeName(agentRuntimeName)) {
    return Result.err(
      new IssueRunServiceError({
        code: 'runtime_error',
        message: 'Agent runtime name is invalid.',
      }),
    )
  }

  if (!env.AgentDO) {
    return Result.err(
      new IssueRunServiceError({
        code: 'runtime_error',
        message: 'AgentDO runtime binding is not configured.',
      }),
    )
  }

  return Result.ok(env.AgentDO.get(env.AgentDO.idFromName(agentRuntimeName)))
}

/**
 * Resolves the issue-run-service Drizzle client through Hyperdrive's pooled
 * connection string. This previously called `drizzle(env.DATABASE_URL)` from
 * the neon-serverless driver, opening a fresh direct-to-Neon WebSocket pool per
 * call that bypassed Hyperdrive, never closed, and defeated Neon autosuspend.
 * `getPooledDb` uses one short-idle socket per invocation-local adapter so no
 * pool survives into another request; Hyperdrive owns origin pooling.
 */
function getDb(env: IssueRunEnv) {
  return getPooledDb(env.HYPERDRIVE.connectionString)
}

export type StartIssueRunOutcome =
  | { kind: 'started'; runId: string }
  | { kind: 'resumed'; runId: string }
  | { kind: 'skipped'; reason: string }

export type CancelIssueRunInput = {
  workspaceId: string
  runId: string
  actor: { type: 'member' | 'agent' | 'system'; id: string }
  reason: string
}

type RunUsage = {
  total_tokens?: unknown
  input_tokens?: unknown
  output_tokens?: unknown
  model?: unknown
  step_count?: unknown
}

function dateToIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function usageFromJson(value: unknown): IssueRun['usage'] {
  const usage = objectOrNull(value) as RunUsage | null
  if (!usage) return null
  const inputTokens =
    typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
  const outputTokens =
    typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const cachedInputTokens =
    typeof (usage as { cached_input_tokens?: unknown }).cached_input_tokens ===
    'number'
      ? (usage as { cached_input_tokens: number }).cached_input_tokens
      : 0
  const totalTokens =
    typeof usage.total_tokens === 'number'
      ? usage.total_tokens
      : inputTokens + outputTokens
  const modelProvider =
    typeof (usage as { model_provider?: unknown }).model_provider === 'string'
      ? (usage as { model_provider: string }).model_provider
      : 'unknown'
  const recordedAtMs =
    typeof (usage as { recorded_at_ms?: unknown }).recorded_at_ms === 'number'
      ? (usage as { recorded_at_ms: number }).recorded_at_ms
      : Date.now()

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    total_tokens: totalTokens,
    model: typeof usage.model === 'string' ? usage.model : 'stub',
    model_provider: modelProvider,
    step_count: typeof usage.step_count === 'number' ? usage.step_count : 0,
    recorded_at_ms: recordedAtMs,
  }
}

export function toIssueRun(row: typeof schema.issueRun.$inferSelect): IssueRun {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    issue_id: row.issueId,
    agent_id: row.agentId,
    host_name: row.hostName,
    status: row.status as IssueRun['status'],
    trigger_source: row.triggerSource as IssueRun['trigger_source'],
    trigger_ref: objectOrNull(row.triggerRef),
    parent_run_id: row.parentRunId,
    workflow_instance_id: row.workflowInstanceId,
    cancel_requested_at: dateToIso(row.cancelRequestedAt),
    context_snapshot: objectOrNull(row.contextSnapshot),
    result_json: objectOrNull(row.resultJson),
    usage_json: objectOrNull(row.usageJson),
    usage: usageFromJson(row.usageJson),
    error: row.error ?? null,
    started_at: dateToIso(row.startedAt),
    finished_at: dateToIso(row.finishedAt),
    created_at: dateToIso(row.createdAt) ?? new Date().toISOString(),
    updated_at: dateToIso(row.updatedAt) ?? new Date().toISOString(),
  }
}

export function toIssueRunEvent(
  row: typeof schema.issueRunEvent.$inferSelect,
): IssueRunEvent {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    issue_id: row.issueId,
    run_id: row.runId,
    seq: row.seq,
    event_type: row.eventType as IssueRunEvent['event_type'],
    stream: row.stream as IssueRunEvent['stream'],
    level: row.level as IssueRunEvent['level'],
    message: row.message ?? null,
    payload: objectOrNull(row.payload),
    created_at: dateToIso(row.createdAt) ?? new Date().toISOString(),
  }
}

export function toIssueWorkProduct(
  row: typeof schema.issueWorkProduct.$inferSelect,
): IssueWorkProduct {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    issue_id: row.issueId,
    run_id: row.runId ?? null,
    agent_id: row.agentId ?? null,
    type: row.type as IssueWorkProduct['type'],
    status: row.status as IssueWorkProduct['status'],
    review_state: row.reviewState as IssueWorkProduct['review_state'],
    is_primary: row.isPrimary,
    title: row.title ?? row.type,
    body: row.body ?? '',
    payload: objectOrNull(row.payload),
    applied_at: dateToIso(row.appliedAt),
    applied_external_id: row.appliedExternalId ?? null,
    applied_external_url: row.appliedExternalUrl ?? null,
    previous_versions_count: 0,
    created_at: dateToIso(row.createdAt) ?? new Date().toISOString(),
    updated_at: dateToIso(row.updatedAt) ?? new Date().toISOString(),
  }
}

function serviceDbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new IssueRunServiceError({
    code: 'db_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function runtimeError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new IssueRunServiceError({
    code: 'runtime_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

export async function startIssueRunRuntime(args: {
  env: IssueRunEnv
  agentRuntimeName: string
  runId: string
  issueId: string
}): Promise<ResultValue<void, IssueRunServiceError>> {
  const stubResult = getIssueRunAgentDoStub(args.env, args.agentRuntimeName)
  if (stubResult.isErr()) return Result.err(stubResult.error)

  const result = await Result.tryPromise({
    try: async () =>
      await stubResult.value.startIssueRunWorkflow({
        runId: args.runId,
        issueId: args.issueId,
      }),
    catch: (cause) => runtimeError('start issue run workflow', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

async function resumeIssueRunRuntime(args: {
  env: IssueRunEnv
  workflowInstanceId: string
}): Promise<ResultValue<void, IssueRunServiceError>> {
  return await sendRunWorkflowControlEvent({
    env: args.env,
    workflowInstanceId: args.workflowInstanceId,
    event: { kind: 'resume' },
    operation: 'resume issue run workflow',
  })
}

async function sendRunWorkflowControlEvent(args: {
  env: IssueRunEnv
  workflowInstanceId: string
  event: RunWorkflowControlEvent
  operation: string
}): Promise<ResultValue<void, IssueRunServiceError>> {
  const workflow = args.env.RUN_WORKFLOW
  if (!workflow) {
    return Result.err(
      new IssueRunServiceError({
        code: 'runtime_error',
        message: 'RUN_WORKFLOW binding is not configured.',
      }),
    )
  }

  const result = await Result.tryPromise({
    try: async () => {
      const instance = await workflow.get(args.workflowInstanceId)
      await instance.sendEvent({
        type: RUN_WORKFLOW_CONTROL_EVENT_TYPE,
        payload: args.event,
      })
    },
    catch: (cause) => runtimeError(args.operation, cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

async function abortRunningIssueRunRuntime(args: {
  env: IssueRunEnv
  agentRuntimeName: string
  runId: string
  issueId: string
}): Promise<ResultValue<void, IssueRunServiceError>> {
  const stubResult = getIssueRunAgentDoStub(args.env, args.agentRuntimeName)
  if (stubResult.isErr()) return Result.err(stubResult.error)

  const result = await Result.tryPromise({
    try: async () =>
      await stubResult.value.cancelIssueRun({
        runId: args.runId,
        issueId: args.issueId,
      }),
    catch: (cause) => runtimeError('abort running issue run runtime', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok()
}

export async function appendIssueRunEvent(args: {
  env: IssueRunEnv
  workspaceId: string
  issueId: string
  runId: string
  eventType: IssueRunEvent['event_type']
  stream?: IssueRunEvent['stream']
  level?: IssueRunEvent['level']
  message?: string | null
  payload?: Record<string, unknown> | null
}): Promise<ResultValue<IssueRunEvent, IssueRunServiceError>> {
  const db = getDb(args.env)
  const result = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${args.runId}::text, 0))
        `)
        const [{ nextSeq }] = (await tx
          .select({
            nextSeq: sql<number>`cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)`,
          })
          .from(schema.issueRunEvent)
          .where(eq(schema.issueRunEvent.runId, args.runId))) as [
          { nextSeq: number },
        ]
        const [event] = await tx
          .insert(schema.issueRunEvent)
          .values({
            id: crypto.randomUUID(),
            workspaceId: args.workspaceId,
            issueId: args.issueId,
            runId: args.runId,
            seq: nextSeq,
            eventType: args.eventType,
            stream: args.stream ?? 'system',
            level: args.level ?? 'info',
            message: args.message ?? null,
            payload: args.payload ?? null,
          })
          .returning()
        return event
      }),
    catch: (cause) => serviceDbError('append issue run event', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (!result.value) {
    return Result.err(
      new IssueRunServiceError({
        code: 'db_error',
        message: 'Issue run event insert returned no row.',
      }),
    )
  }
  return Result.ok(toIssueRunEvent(result.value))
}

async function markStartFailed(args: {
  env: IssueRunEnv
  input: StartIssueRunInput
  runId: string
  error: IssueRunServiceError
}): Promise<ResultValue<void, IssueRunServiceError>> {
  const db = getDb(args.env)
  const now = new Date()
  const writeResult = await Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.issueRun)
          .set({
            status: 'failed',
            error: args.error.message,
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.issueRun.id, args.runId))
        await tx
          .update(schema.issue)
          .set({ activeRunId: null, updatedAt: now })
          .where(
            and(
              eq(schema.issue.id, args.input.issueId),
              eq(schema.issue.activeRunId, args.runId),
            ),
          )
      })
    },
    catch: (cause) => serviceDbError('mark workflow start failure', cause),
  })
  if (writeResult.isErr()) return Result.err(writeResult.error)

  const eventResult = await appendIssueRunEvent({
    env: args.env,
    workspaceId: args.input.workspaceId,
    issueId: args.input.issueId,
    runId: args.runId,
    eventType: 'issue_run:failed',
    stream: 'system',
    level: 'error',
    message: 'Run failed before workflow start',
    payload: {
      reason: 'workflow_start_failed',
      retry_after_ms: WORKFLOW_START_FAILURE_RETRY_DELAY_MS,
      error: args.error.message,
    },
  })
  if (eventResult.isErr()) return Result.err(eventResult.error)

  return Result.ok()
}

export async function startIssueRun(
  env: IssueRunEnv,
  input: StartIssueRunInput,
): Promise<ResultValue<StartIssueRunOutcome, IssueRunServiceError>> {
  const db = getDb(env)
  const lookupResult = await Result.tryPromise({
    try: async () => {
      const [issue] = await db
        .select({
          id: schema.issue.id,
          workspaceId: schema.issue.workspaceId,
          status: schema.issue.status,
        })
        .from(schema.issue)
        .where(
          and(
            eq(schema.issue.id, input.issueId),
            eq(schema.issue.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      const [agent] = await db
        .select({
          id: schema.agent.id,
          workspaceId: schema.agent.workspaceId,
          hostName: schema.agent.hostName,
          status: schema.agent.status,
        })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.id, input.agentId),
            eq(schema.agent.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      return { issue: issue ?? null, agent: agent ?? null }
    },
    catch: (cause) => serviceDbError('load issue run inputs', cause),
  })
  if (lookupResult.isErr()) return Result.err(lookupResult.error)

  const { issue, agent } = lookupResult.value
  if (!issue) {
    return Result.err(
      new IssueRunServiceError({
        code: 'issue_not_found',
        message: 'Issue not found.',
      }),
    )
  }
  if (!agent || agent.status === 'archived') {
    return Result.err(
      new IssueRunServiceError({
        code: 'agent_not_found',
        message: 'Agent not found.',
      }),
    )
  }
  const agentRuntimeName = agent.hostName ?? agent.id
  const skipReason = shouldSkipIssueRunStart({
    issueStatus: issue.status as IssueStatus | null,
    source: input.source,
  })
  if (skipReason) {
    return Result.ok({ kind: 'skipped', reason: skipReason })
  }

  const runId = crypto.randomUUID()
  const writeResult = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${input.issueId}::text, 0))
        `)

        const [activeRun] = await tx
          .select({
            id: schema.issueRun.id,
            status: schema.issueRun.status,
            agentId: schema.issueRun.agentId,
            issueId: schema.issueRun.issueId,
            workflowInstanceId: schema.issueRun.workflowInstanceId,
          })
          .from(schema.issueRun)
          .where(
            and(
              eq(schema.issueRun.issueId, input.issueId),
              eq(schema.issueRun.agentId, input.agentId),
              inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
            ),
          )
          .limit(1)

        if (activeRun) {
          if (
            canResumeWaitingRun({
              agentId: input.agentId,
              runAgentId: activeRun.agentId,
              runStatus: activeRun.status as IssueRunStatus,
              source: input.source,
            })
          ) {
            await tx.insert(schema.issueRunEvent).values({
              id: crypto.randomUUID(),
              workspaceId: input.workspaceId,
              issueId: input.issueId,
              runId: activeRun.id,
              seq: sql<number>`(
                select cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)
                from ${schema.issueRunEvent}
                where ${schema.issueRunEvent.runId} = ${activeRun.id}::uuid
              )`,
              eventType: 'issue_run:message',
              stream: 'system',
              level: 'info',
              message: 'User answered pending question',
              payload: {
                source: input.source,
                trigger: input.trigger ?? {},
                actor: input.actor,
              },
            })
            return {
              kind: 'resumed' as const,
              runId: activeRun.id,
              workflowInstanceId: activeRun.workflowInstanceId,
            }
          }
          return { kind: 'skipped' as const, reason: 'active_run' }
        }

        await tx.insert(schema.issueRun).values({
          id: runId,
          workspaceId: input.workspaceId,
          issueId: input.issueId,
          agentId: input.agentId,
          hostName: agentRuntimeName,
          status: 'queued',
          triggerSource: input.source,
          triggerRef: input.trigger ?? null,
          workflowInstanceId: runId,
          contextSnapshot: {
            source: input.source,
            trigger: input.trigger ?? {},
            actor: input.actor,
          },
        })
        await tx
          .update(schema.issue)
          .set({ activeRunId: runId, updatedAt: new Date() })
          .where(eq(schema.issue.id, input.issueId))
        await tx.insert(schema.issueRunEvent).values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          issueId: input.issueId,
          runId,
          seq: 1,
          eventType: 'issue_run:queued',
          stream: 'system',
          level: 'info',
          message: 'Run queued',
          payload: {
            source: input.source,
            actor: input.actor,
          },
        })

        return { kind: 'started' as const, runId }
      }),
    catch: (cause) => serviceDbError('create issue run', cause),
  })
  if (writeResult.isErr()) return Result.err(writeResult.error)
  if (writeResult.value.kind === 'resumed') {
    const resumeResult = await resumeIssueRunRuntime({
      env,
      workflowInstanceId:
        writeResult.value.workflowInstanceId ?? writeResult.value.runId,
    })
    if (resumeResult.isErr()) return Result.err(resumeResult.error)
    return Result.ok({ kind: 'resumed', runId: writeResult.value.runId })
  }
  if (writeResult.value.kind !== 'started') return Result.ok(writeResult.value)

  const startResult = await startIssueRunRuntime({
    env,
    agentRuntimeName,
    runId: writeResult.value.runId,
    issueId: input.issueId,
  })
  if (startResult.isErr()) {
    const failedResult = await markStartFailed({
      env,
      input,
      runId: writeResult.value.runId,
      error: startResult.error,
    })
    if (failedResult.isErr()) return Result.err(failedResult.error)
    return Result.err(startResult.error)
  }

  return Result.ok(writeResult.value)
}

export async function cancelIssueRun(
  env: IssueRunEnv,
  input: CancelIssueRunInput,
): Promise<ResultValue<void, IssueRunServiceError>> {
  const db = getDb(env)
  const result = await Result.tryPromise({
    try: async () => {
      const [run] = await db
        .select()
        .from(schema.issueRun)
        .where(
          and(
            eq(schema.issueRun.id, input.runId),
            eq(schema.issueRun.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
      if (!run) return { kind: 'missing' as const }

      const previousStatus = run.status
      await db
        .update(schema.issueRun)
        .set({
          cancelRequestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.issueRun.id, input.runId))
      return {
        kind: 'cancelled' as const,
        agentRuntimeName: run.hostName,
        issueId: run.issueId,
        previousStatus,
        workflowInstanceId: run.workflowInstanceId,
      }
    },
    catch: (cause) => serviceDbError('cancel issue run', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (result.value.kind === 'missing') {
    return Result.err(
      new IssueRunServiceError({
        code: 'run_not_found',
        message: 'Issue run not found.',
      }),
    )
  }
  const issueId = result.value.issueId
  const eventResult = await appendIssueRunEvent({
    env,
    workspaceId: input.workspaceId,
    issueId,
    runId: input.runId,
    eventType: 'issue_run:message',
    stream: 'system',
    message: 'Cancellation requested',
    payload: {
      reason: input.reason,
      actor: input.actor,
      previous_status: result.value.previousStatus,
    },
  })
  if (eventResult.isErr()) return Result.err(eventResult.error)

  const workflowResult = await sendRunWorkflowControlEvent({
    env,
    workflowInstanceId: result.value.workflowInstanceId ?? input.runId,
    event: { kind: 'cancel' },
    operation: 'cancel run workflow',
  })
  if (workflowResult.isErr()) return Result.err(workflowResult.error)

  if (result.value.previousStatus === 'running') {
    const abortResult = await abortRunningIssueRunRuntime({
      env,
      agentRuntimeName: result.value.agentRuntimeName,
      runId: input.runId,
      issueId,
    })
    if (abortResult.isErr()) return Result.err(abortResult.error)
  }
  return Result.ok()
}

export async function listIssueRuns(args: {
  env: IssueRunEnv
  workspaceId: string
  issueId: string
  limit?: number
}): Promise<ResultValue<IssueRun[], IssueRunServiceError>> {
  const db = getDb(args.env)
  const result = await Result.tryPromise({
    try: async () =>
      await db
        .select()
        .from(schema.issueRun)
        .where(
          and(
            eq(schema.issueRun.workspaceId, args.workspaceId),
            eq(schema.issueRun.issueId, args.issueId),
          ),
        )
        .orderBy(desc(schema.issueRun.createdAt))
        .limit(args.limit ?? 50),
    catch: (cause) => serviceDbError('list issue runs', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value.map(toIssueRun))
}

export async function getActiveIssueRun(args: {
  env: IssueRunEnv
  workspaceId: string
  issueId: string
}): Promise<ResultValue<IssueRun | null, IssueRunServiceError>> {
  const db = getDb(args.env)
  const result = await Result.tryPromise({
    try: async () => {
      const [run] = await db
        .select()
        .from(schema.issueRun)
        .where(
          and(
            eq(schema.issueRun.workspaceId, args.workspaceId),
            eq(schema.issueRun.issueId, args.issueId),
            inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
          ),
        )
        .orderBy(desc(schema.issueRun.createdAt))
        .limit(1)
      return run ?? null
    },
    catch: (cause) => serviceDbError('get active issue run', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value ? toIssueRun(result.value) : null)
}

export async function listIssueRunEvents(args: {
  env: IssueRunEnv
  workspaceId: string
  issueId?: string
  runId?: string
  after?: number
  limit?: number
}): Promise<ResultValue<IssueRunEvent[], IssueRunServiceError>> {
  const db = getDb(args.env)
  const conditions = [eq(schema.issueRunEvent.workspaceId, args.workspaceId)]
  if (args.issueId)
    conditions.push(eq(schema.issueRunEvent.issueId, args.issueId))
  if (args.runId) conditions.push(eq(schema.issueRunEvent.runId, args.runId))
  if (args.after !== undefined) {
    conditions.push(sql`${schema.issueRunEvent.seq} > ${args.after}`)
  }

  const result = await Result.tryPromise({
    try: async () => {
      const baseQuery = db
        .select()
        .from(schema.issueRunEvent)
        .where(and(...conditions))

      return args.runId
        ? await baseQuery
            .orderBy(schema.issueRunEvent.seq)
            .limit(args.limit ?? 200)
        : await baseQuery
            .orderBy(schema.issueRunEvent.createdAt, schema.issueRunEvent.seq)
            .limit(args.limit ?? 200)
    },
    catch: (cause) => serviceDbError('list issue run events', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value.map(toIssueRunEvent))
}

export async function listIssueWorkProducts(args: {
  env: IssueRunEnv
  workspaceId: string
  issueId: string
}): Promise<ResultValue<IssueWorkProduct[], IssueRunServiceError>> {
  const db = getDb(args.env)
  const result = await Result.tryPromise({
    try: async () =>
      await db
        .select()
        .from(schema.issueWorkProduct)
        .where(
          and(
            eq(schema.issueWorkProduct.workspaceId, args.workspaceId),
            eq(schema.issueWorkProduct.issueId, args.issueId),
          ),
        )
        .orderBy(desc(schema.issueWorkProduct.updatedAt)),
    catch: (cause) => serviceDbError('list issue work products', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value.map(toIssueWorkProduct))
}
