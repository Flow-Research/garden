import { and, desc, eq, sql } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { createLogger } from '@garden/core/logger'
import type { AppEnv } from '@/lib/server/env'
import { getDb, schema } from '@/lib/server/db'
import {
  appendIssueRunEvent,
  enqueueIssueRunRuntime,
  startIssueRun,
} from './issue-run'

const logger = createLogger('issue-run-reconciler')

const SILENT_RUN_MS = 120_000
const MAX_WAKEUP_ATTEMPTS = 3
const WAKEUP_BACKOFF_MS = [5_000, 10_000, 20_000] as const
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

export type ReconcileReport = {
  silentRunsReaped: number
  wakeupsRestarted: number
  wakeupsFailed: number
  recurrencesFannedOut: number
  approvalsExpired: number
}

export class IssueRunReconcilerError extends TaggedError(
  'IssueRunReconcilerError',
)<{
  code:
    | 'approval_sweep_failed'
    | 'db_error'
    | 'enqueue_failed'
    | 'invalid_cron'
    | 'reconcile_failed'
    | 'run_not_found'
    | 'start_failed'
  message: string
  cause?: unknown
}>() {}

type SilentRunRow = {
  id: string
}

type WakeupCandidateRow = {
  wakeup_id: string
  workspace_id: string
  issue_id: string
  agent_id: string
  host_name: string
  source: string
  trigger_comment_id: string | null
  trigger_source_id: string | null
  correlation_id: string | null
  attempt_count: number
}

type RecurrenceRow = {
  id: string
  workspace_id: string
  issue_id: string
  agent_id: string
  cron: string
  next_fire_at: Date | string | null
}

type ApprovalRow = {
  id: string
  agent_id: string
  issue_id: string | null
  kind: string
  context: string | null
}

function reconcilerError(args: {
  code: IssueRunReconcilerError['code']
  message: string
  cause?: unknown
}) {
  return new IssueRunReconcilerError(args)
}

function dbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return reconcilerError({
    code: 'db_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function retryDelayMs(attemptCount: number) {
  const index = Math.min(
    Math.max(attemptCount - 1, 0),
    WAKEUP_BACKOFF_MS.length - 1,
  )
  return WAKEUP_BACKOFF_MS[index]
}

function nextMinuteBoundary(from: Date) {
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)
  return next
}

function pendingAgentIdFromContext(value: string | null) {
  const prefix = 'agent_proposal:'
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null
}

function nextFireFromCron(
  cron: string,
  from: Date,
): ResultValue<Date, IssueRunReconcilerError> {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    return Result.err(
      reconcilerError({
        code: 'invalid_cron',
        message: `Unsupported recurrence cron "${cron}".`,
      }),
    )
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (
    hour !== '*' ||
    dayOfMonth !== '*' ||
    month !== '*' ||
    dayOfWeek !== '*'
  ) {
    return Result.err(
      reconcilerError({
        code: 'invalid_cron',
        message: `Only minute-level recurrence cron is supported: "${cron}".`,
      }),
    )
  }

  if (minute === '*') return Result.ok(nextMinuteBoundary(from))

  const stepMatch = minute.match(/^\*\/([1-9]\d*)$/)
  if (stepMatch) {
    const step = Number(stepMatch[1])
    if (!Number.isFinite(step) || step < 1 || step > 59) {
      return Result.err(
        reconcilerError({
          code: 'invalid_cron',
          message: `Unsupported recurrence minute step "${minute}".`,
        }),
      )
    }

    let candidate = nextMinuteBoundary(from)
    for (let i = 0; i < 120; i += 1) {
      if (candidate.getMinutes() % step === 0) return Result.ok(candidate)
      candidate = new Date(candidate.getTime() + 60_000)
    }
  }

  const fixedMinute = Number(minute)
  if (Number.isInteger(fixedMinute) && fixedMinute >= 0 && fixedMinute <= 59) {
    const candidate = new Date(from)
    candidate.setSeconds(0, 0)
    candidate.setMinutes(fixedMinute)
    if (candidate <= from) candidate.setHours(candidate.getHours() + 1)
    return Result.ok(candidate)
  }

  return Result.err(
    reconcilerError({
      code: 'invalid_cron',
      message: `Unsupported recurrence minute field "${minute}".`,
    }),
  )
}

async function markRunFailed(args: {
  env: AppEnv
  runId: string
  reason: string
  now: Date
}): Promise<ResultValue<void, IssueRunReconcilerError>> {
  const db = getDb(args.env)
  const loadResult = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select({
          id: schema.issueRun.id,
          workspaceId: schema.issueRun.workspaceId,
          issueId: schema.issueRun.issueId,
          wakeupId: schema.issueRun.wakeupId,
          wakeupAttemptCount: schema.issueWakeup.attemptCount,
        })
        .from(schema.issueRun)
        .innerJoin(
          schema.issueWakeup,
          eq(schema.issueWakeup.id, schema.issueRun.wakeupId),
        )
        .where(eq(schema.issueRun.id, args.runId))
        .limit(1)
      return row ?? null
    },
    catch: (cause) => dbError('load run for failure', cause),
  })
  if (loadResult.isErr()) return Result.err(loadResult.error)
  const row = loadResult.value
  if (!row) {
    return Result.err(
      reconcilerError({
        code: 'run_not_found',
        message: 'Issue run not found while reconciling.',
      }),
    )
  }

  const nextAttemptAt = new Date(
    args.now.getTime() + retryDelayMs(row.wakeupAttemptCount),
  )
  const updateResult = await Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.issueRun)
          .set({
            status: 'failed',
            error: args.reason,
            finishedAt: args.now,
            updatedAt: args.now,
          })
          .where(eq(schema.issueRun.id, args.runId))
        await tx
          .update(schema.issue)
          .set({ activeRunId: null, updatedAt: args.now })
          .where(
            and(
              eq(schema.issue.id, row.issueId),
              eq(schema.issue.activeRunId, args.runId),
            ),
          )
        await tx
          .update(schema.issueWakeup)
          .set({
            nextAttemptAt,
            updatedAt: args.now,
          })
          .where(eq(schema.issueWakeup.id, row.wakeupId))
      })
    },
    catch: (cause) => dbError('mark run failed', cause),
  })
  if (updateResult.isErr()) return Result.err(updateResult.error)

  const eventResult = await appendIssueRunEvent({
    env: args.env,
    workspaceId: row.workspaceId,
    issueId: row.issueId,
    runId: args.runId,
    eventType: 'issue_run:failed',
    stream: 'system',
    level: 'error',
    message: 'Run failed during reconciliation',
    payload: {
      reason: args.reason,
      retry_after_ms: retryDelayMs(row.wakeupAttemptCount),
    },
  })
  if (eventResult.isErr()) {
    return Result.err(
      reconcilerError({
        code: 'reconcile_failed',
        message: eventResult.error.message,
        cause: eventResult.error,
      }),
    )
  }

  return Result.ok()
}

async function reapSilentRuns(
  env: AppEnv,
  now: Date,
): Promise<ResultValue<number, IssueRunReconcilerError>> {
  const db = getDb(env)
  const silentBefore = new Date(now.getTime() - SILENT_RUN_MS)
  const rowsResult = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<SilentRunRow>(sql`
        select r.id
        from issue_run r
        where r.status in ('queued', 'running')
          and not exists (
            select 1
            from issue_run_event e
            where e.run_id = r.id
              and e.created_at > ${silentBefore}
          )
        order by r.updated_at
        limit 50
      `)
      return rows.rows
    },
    catch: (cause) => dbError('load silent issue runs', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  let count = 0
  for (const row of rowsResult.value) {
    const failedResult = await markRunFailed({
      env,
      runId: row.id,
      reason: 'silent_timeout',
      now,
    })
    if (failedResult.isErr()) return Result.err(failedResult.error)
    count += 1
  }

  return Result.ok(count)
}

async function restartWakeup(args: {
  env: AppEnv
  row: WakeupCandidateRow
  now: Date
}): Promise<ResultValue<'restarted' | 'failed', IssueRunReconcilerError>> {
  const db = getDb(args.env)
  if (args.row.attempt_count >= MAX_WAKEUP_ATTEMPTS) {
    const failResult = await failWakeupAndBlockIssue({
      env: args.env,
      wakeupId: args.row.wakeup_id,
      reason: 'attempts_exhausted',
      now: args.now,
    })
    if (failResult.isErr()) return Result.err(failResult.error)
    return Result.ok('failed')
  }

  const runId = crypto.randomUUID()
  const nextAttemptCount = args.row.attempt_count + 1
  const createResult = await Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.issueWakeup)
          .set({
            attemptCount: nextAttemptCount,
            claimedAt: args.now,
            nextAttemptAt: null,
            updatedAt: args.now,
          })
          .where(eq(schema.issueWakeup.id, args.row.wakeup_id))
        await tx.insert(schema.issueRun).values({
          id: runId,
          workspaceId: args.row.workspace_id,
          issueId: args.row.issue_id,
          agentId: args.row.agent_id,
          hostName: args.row.host_name,
          wakeupId: args.row.wakeup_id,
          status: 'queued',
          contextSnapshot: {
            source: args.row.source,
            trigger: {
              commentId: args.row.trigger_comment_id,
              sourceBindingId: args.row.trigger_source_id,
              correlationId: args.row.correlation_id,
            },
            actor: { type: 'system', id: 'reconciler' },
            attempt: nextAttemptCount,
          },
        })
        await tx
          .update(schema.issue)
          .set({ activeRunId: runId, updatedAt: args.now })
          .where(eq(schema.issue.id, args.row.issue_id))
        await tx.insert(schema.issueRunEvent).values({
          id: crypto.randomUUID(),
          workspaceId: args.row.workspace_id,
          issueId: args.row.issue_id,
          runId,
          seq: 1,
          eventType: 'issue_run:queued',
          stream: 'system',
          level: 'info',
          message: 'Run restarted by reconciler',
          payload: {
            attempt: nextAttemptCount,
            source: args.row.source,
          },
        })
      })
    },
    catch: (cause) => dbError('restart issue wakeup', cause),
  })
  if (createResult.isErr()) return Result.err(createResult.error)

  const enqueueResult = await enqueueIssueRunRuntime({
    env: args.env,
    agentRuntimeName: args.row.host_name,
    runId,
    issueId: args.row.issue_id,
  })
  if (enqueueResult.isErr()) {
    const failedResult = await markRunFailed({
      env: args.env,
      runId,
      reason: 'enqueue_failed',
      now: args.now,
    })
    if (failedResult.isErr()) return Result.err(failedResult.error)
    return Result.err(
      reconcilerError({
        code: 'enqueue_failed',
        message: 'Failed to enqueue restarted issue run.',
        cause: enqueueResult.error,
      }),
    )
  }

  return Result.ok('restarted')
}

async function restartClaimedWakeups(
  env: AppEnv,
  now: Date,
): Promise<
  ResultValue<{ restarted: number; failed: number }, IssueRunReconcilerError>
> {
  const db = getDb(env)
  const rowsResult = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<WakeupCandidateRow>(sql`
        select
          w.id as wakeup_id,
          w.workspace_id,
          w.issue_id,
          w.agent_id,
          w.host_name,
          w.source,
          w.trigger_comment_id,
          w.trigger_source_id,
          w.correlation_id,
          w.attempt_count
        from issue_wakeup w
        where w.status = 'claimed'
          and (w.next_attempt_at is null or w.next_attempt_at <= ${now})
          and not exists (
            select 1
            from issue_run r
            where r.wakeup_id = w.id
              and r.status in ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')
          )
        order by w.created_at
        limit 50
      `)
      return rows.rows
    },
    catch: (cause) => dbError('load claimed wakeups', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  let restarted = 0
  let failed = 0
  for (const row of rowsResult.value) {
    const restartResult = await restartWakeup({ env, row, now })
    if (restartResult.isErr()) return Result.err(restartResult.error)
    if (restartResult.value === 'restarted') restarted += 1
    else failed += 1
  }

  return Result.ok({ restarted, failed })
}

async function failWakeupAndBlockIssue(args: {
  env: AppEnv
  wakeupId: string
  reason: string
  now: Date
}): Promise<ResultValue<void, IssueRunReconcilerError>> {
  const db = getDb(args.env)
  const loadResult = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select({
          id: schema.issueWakeup.id,
          workspaceId: schema.issueWakeup.workspaceId,
          issueId: schema.issueWakeup.issueId,
          agentId: schema.issueWakeup.agentId,
        })
        .from(schema.issueWakeup)
        .where(eq(schema.issueWakeup.id, args.wakeupId))
        .limit(1)
      return row ?? null
    },
    catch: (cause) => dbError('load failed wakeup', cause),
  })
  if (loadResult.isErr()) return Result.err(loadResult.error)
  if (!loadResult.value) {
    return Result.err(
      reconcilerError({
        code: 'run_not_found',
        message: 'Issue wakeup not found while blocking issue.',
      }),
    )
  }

  const row = loadResult.value
  const blockResult = await Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.issueWakeup)
          .set({
            status: 'failed',
            completedAt: args.now,
            updatedAt: args.now,
          })
          .where(eq(schema.issueWakeup.id, args.wakeupId))
        await tx
          .update(schema.issue)
          .set({
            status: 'blocked',
            activeRunId: null,
            updatedAt: args.now,
          })
          .where(eq(schema.issue.id, row.issueId))
        await tx.insert(schema.issueComment).values({
          id: crypto.randomUUID(),
          issueId: row.issueId,
          authorType: 'agent',
          authorId: row.agentId,
          body: `Agent run blocked by reconciler: ${args.reason}.`,
          mentions: null,
        })
      })
    },
    catch: (cause) => dbError('fail wakeup and block issue', cause),
  })
  if (blockResult.isErr()) return Result.err(blockResult.error)

  return Result.ok()
}

async function fanOutRecurrences(
  env: AppEnv,
  now: Date,
): Promise<ResultValue<number, IssueRunReconcilerError>> {
  const db = getDb(env)
  const rowsResult = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<RecurrenceRow>(sql`
        select id, workspace_id, issue_id, agent_id, cron, next_fire_at
        from issue_recurrence
        where enabled = true
          and next_fire_at is not null
          and next_fire_at <= ${now}
        order by next_fire_at
        limit 50
      `)
      return rows.rows
    },
    catch: (cause) => dbError('load due issue recurrences', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  let count = 0
  for (const row of rowsResult.value) {
    const nextFireResult = nextFireFromCron(row.cron, now)
    if (nextFireResult.isErr()) {
      const disableResult = await Result.tryPromise({
        try: async () => {
          await db
            .update(schema.issueRecurrence)
            .set({ enabled: false, updatedAt: now })
            .where(eq(schema.issueRecurrence.id, row.id))
        },
        catch: (cause) => dbError('disable invalid issue recurrence', cause),
      })
      if (disableResult.isErr()) return Result.err(disableResult.error)
      logger.error(
        'disabled invalid issue recurrence',
        nextFireResult.error.message,
      )
      continue
    }

    const updateResult = await Result.tryPromise({
      try: async () => {
        await db
          .update(schema.issueRecurrence)
          .set({
            lastFiredAt: now,
            nextFireAt: nextFireResult.value,
            updatedAt: now,
          })
          .where(eq(schema.issueRecurrence.id, row.id))
      },
      catch: (cause) => dbError('advance issue recurrence', cause),
    })
    if (updateResult.isErr()) return Result.err(updateResult.error)

    const startResult = await startIssueRun(env, {
      workspaceId: row.workspace_id,
      issueId: row.issue_id,
      agentId: row.agent_id,
      source: 'scheduled',
      trigger: {
        correlationId: `${row.id}:${new Date(row.next_fire_at ?? now).toISOString()}`,
      },
      actor: { type: 'system', id: 'reconciler' },
    })
    if (startResult.isErr()) {
      return Result.err(
        reconcilerError({
          code: 'start_failed',
          message: startResult.error.message,
          cause: startResult.error,
        }),
      )
    }
    if (startResult.value.kind === 'enqueued') count += 1
  }

  return Result.ok(count)
}

async function sweepStaleApprovals(
  env: AppEnv,
  now: Date,
): Promise<ResultValue<number, IssueRunReconcilerError>> {
  const db = getDb(env)
  const staleBefore = new Date(now.getTime() - APPROVAL_TTL_MS)
  const rowsResult = await Result.tryPromise({
    try: async () => {
      const rows = await db
        .update(schema.permissionRequest)
        .set({
          status: 'denied',
          resolvedAt: now,
          context: sql<string>`coalesce(${schema.permissionRequest.context}, '') || E'\n\nDenied automatically: stale approval request.'`,
        })
        .where(
          and(
            eq(schema.permissionRequest.status, 'pending'),
            sql`${schema.permissionRequest.requestedAt} < ${staleBefore}`,
          ),
        )
        .returning({
          id: schema.permissionRequest.id,
          agent_id: schema.permissionRequest.agentId,
          issue_id: schema.permissionRequest.issueId,
          kind: schema.permissionRequest.kind,
          context: schema.permissionRequest.context,
        })
      return rows
    },
    catch: (cause) => dbError('sweep stale approvals', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  for (const row of rowsResult.value as ApprovalRow[]) {
    if (row.kind === 'agent_proposal') {
      const pendingAgentId = pendingAgentIdFromContext(row.context)
      if (pendingAgentId) {
        const archiveResult = await Result.tryPromise({
          try: async () => {
            await db
              .update(schema.agent)
              .set({ status: 'archived' })
              .where(
                and(
                  eq(schema.agent.id, pendingAgentId),
                  eq(schema.agent.status, 'pending_approval'),
                ),
              )
          },
          catch: (cause) => dbError('archive stale proposed agent', cause),
        })
        if (archiveResult.isErr()) return Result.err(archiveResult.error)
      }
    }

    const issueId = row.issue_id
    if (!issueId) continue
    const runsResult = await Result.tryPromise({
      try: async () =>
        await db
          .select()
          .from(schema.issueRun)
          .where(
            and(
              eq(schema.issueRun.issueId, issueId),
              eq(schema.issueRun.agentId, row.agent_id),
              eq(schema.issueRun.status, 'waiting_for_approval'),
            ),
          )
          .orderBy(desc(schema.issueRun.createdAt))
          .limit(1),
      catch: (cause) => dbError('load stale approval run', cause),
    })
    if (runsResult.isErr()) return Result.err(runsResult.error)
    const run = runsResult.value[0]
    if (!run) continue

    const updateRunResult = await Result.tryPromise({
      try: async () => {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.issueRun)
            .set({
              status: 'failed',
              error: 'approval_stale',
              finishedAt: now,
              updatedAt: now,
            })
            .where(eq(schema.issueRun.id, run.id))
          await tx
            .update(schema.issue)
            .set({ activeRunId: null, updatedAt: now })
            .where(
              and(
                eq(schema.issue.id, run.issueId),
                eq(schema.issue.activeRunId, run.id),
              ),
            )
        })
      },
      catch: (cause) => dbError('fail stale approval run', cause),
    })
    if (updateRunResult.isErr()) return Result.err(updateRunResult.error)

    const eventResult = await appendIssueRunEvent({
      env,
      workspaceId: run.workspaceId,
      issueId: run.issueId,
      runId: run.id,
      eventType: 'issue_run:reconciler_action',
      stream: 'system',
      level: 'warn',
      message: 'Approval request expired',
      payload: {
        permission_request_id: row.id,
        reason: 'stale_approval',
      },
    })
    if (eventResult.isErr()) {
      return Result.err(
        reconcilerError({
          code: 'approval_sweep_failed',
          message: eventResult.error.message,
          cause: eventResult.error,
        }),
      )
    }
  }

  return Result.ok(rowsResult.value.length)
}

export async function reconcile(
  env: AppEnv,
): Promise<ResultValue<ReconcileReport, IssueRunReconcilerError>> {
  // Each pass is best-effort and independent. Don't short-circuit — a stuck
  // row in one pass shouldn't block the others for the next minute. Log per
  // pass; the next tick retries.
  const now = new Date()

  const silentResult = await reapSilentRuns(env, now)
  if (silentResult.isErr()) {
    logger.error('reapSilentRuns failed', silentResult.error.message)
  }

  const wakeupsResult = await restartClaimedWakeups(env, now)
  if (wakeupsResult.isErr()) {
    logger.error('restartClaimedWakeups failed', wakeupsResult.error.message)
  }

  const recurrenceResult = await fanOutRecurrences(env, now)
  if (recurrenceResult.isErr()) {
    logger.error('fanOutRecurrences failed', recurrenceResult.error.message)
  }

  const approvalsResult = await sweepStaleApprovals(env, now)
  if (approvalsResult.isErr()) {
    logger.error('sweepStaleApprovals failed', approvalsResult.error.message)
  }

  return Result.ok({
    silentRunsReaped: silentResult.isOk() ? silentResult.value : 0,
    wakeupsRestarted: wakeupsResult.isOk() ? wakeupsResult.value.restarted : 0,
    wakeupsFailed: wakeupsResult.isOk() ? wakeupsResult.value.failed : 0,
    recurrencesFannedOut: recurrenceResult.isOk() ? recurrenceResult.value : 0,
    approvalsExpired: approvalsResult.isOk() ? approvalsResult.value : 0,
  })
}
