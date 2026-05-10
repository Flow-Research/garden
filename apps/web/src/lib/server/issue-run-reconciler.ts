import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { createLogger } from '@garden/core/logger'
import { LIVE_RUN_STATUSES } from '@garden/core/issues/run-sync'
import type { AppEnv } from '@/lib/server/env'
import { getDb, schema } from '@/lib/server/db'
import {
  appendIssueRunEvent,
  enqueueIssueRunRuntime,
} from '@garden/core/issues/run-service'

const logger = createLogger('issue-run-reconciler')

const DEFAULT_MAX_WAKEUP_ATTEMPTS = 3
const RUNTIME_RECOVERY_MAX_WAKEUP_ATTEMPTS = 12
const WAKEUP_BACKOFF_MS = [5_000, 10_000, 20_000] as const
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

function sqlTextList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )
}

export type ReconcileReport = {
  silentRunsReaped: number
  wakeupsRestarted: number
  wakeupsFailed: number
  triggersRecovered: number
  automationRunsSynced: number
  approvalsExpired: number
}

export class IssueRunReconcilerError extends TaggedError(
  'IssueRunReconcilerError',
)<{
  code:
    | 'approval_sweep_failed'
    | 'automation_recovery_failed'
    | 'automation_sync_failed'
    | 'db_error'
    | 'enqueue_failed'
    | 'reconcile_failed'
    | 'run_not_found'
  message: string
  cause?: unknown
}>() {}

type SilentRunRow = {
  id: string
  reason: string
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
  latest_run_error: string | null
}

type ApprovalRow = {
  id: string
  agent_id: string
  issue_id: string | null
  kind: string
  context: string | null
}

type StrandedTriggerRow = {
  trigger_id: string
  automation_id: string
  concurrency_policy: string
  next_run_at: Date
}

type AutomationRunSyncRow = {
  automation_run_id: string
  issue_run_status: string
  issue_run_error: string | null
  issue_run_finished_at: Date | null
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

function maxWakeupAttemptsForError(error: string | null) {
  switch (error) {
    case 'fiber_recovered':
    case 'silent_timeout':
    case 'tool_timeout':
    case 'enqueue_failed':
      return RUNTIME_RECOVERY_MAX_WAKEUP_ATTEMPTS
    case 'no_resolution':
      return 2
    default:
      return DEFAULT_MAX_WAKEUP_ATTEMPTS
  }
}

function exhaustedWakeupComment(reason: string) {
  switch (reason) {
    case 'attempts_exhausted:fiber_recovered':
      return 'Garden automatically retried this run after runtime recovery failures, but the execution kept disappearing before a work product was produced. Moving the issue to blocked so it is visible for intervention.'
    case 'attempts_exhausted:silent_timeout':
      return 'Garden automatically retried this run after it stopped making observable progress, but the retries still went silent before a work product was produced. Moving the issue to blocked so it is visible for intervention.'
    case 'attempts_exhausted:tool_timeout':
      return 'Garden automatically retried this run after a tool call stopped returning, but the retries still could not produce a work product. Moving the issue to blocked so it is visible for intervention.'
    case 'attempts_exhausted:enqueue_failed':
      return 'Garden automatically retried this run after enqueue failures, but the runtime could not be started reliably. Moving the issue to blocked so it is visible for intervention.'
    case 'attempts_exhausted:no_resolution':
      return 'Garden retried this run after it ended without a work product, but the retry still did not produce an output. Moving the issue to blocked so it is visible for intervention.'
    default:
      return `Garden automatically retried this run, but it exhausted recovery attempts (${reason}). Moving the issue to blocked so it is visible for intervention.`
  }
}

function pendingAgentIdFromContext(value: string | null) {
  const prefix = 'agent_proposal:'
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null
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
  const issueId = row.issueId
  const wakeupId = row.wakeupId
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
        if (issueId) {
          await tx
            .update(schema.issue)
            .set({ activeRunId: null, updatedAt: args.now })
            .where(
              and(
                eq(schema.issue.id, issueId),
                eq(schema.issue.activeRunId, args.runId),
              ),
            )
        }
        if (wakeupId) {
          await tx
            .update(schema.issueWakeup)
            .set({
              nextAttemptAt,
              updatedAt: args.now,
            })
            .where(eq(schema.issueWakeup.id, wakeupId))
        }
        await tx
          .update(schema.automationRun)
          .set({
            status: 'failed',
            completedAt: args.now,
            failureReason: args.reason,
          })
          .where(eq(schema.automationRun.issueRunId, args.runId))
      })
    },
    catch: (cause) => dbError('mark run failed', cause),
  })
  if (updateResult.isErr()) return Result.err(updateResult.error)

  if (!issueId) return Result.ok()

  const eventResult = await appendIssueRunEvent({
    env: args.env,
    workspaceId: row.workspaceId,
    issueId,
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
  const rowsResult = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<SilentRunRow>(sql`
        with stale_runs as (
          select r.id, 'silent_timeout'::text as reason
          from issue_run r
          where (
            (
              r.status = 'running'
              and r.started_at < ((now() at time zone 'utc') - interval '2 hours')
            )
            or (
              r.status = 'queued'
              and r.created_at < ((now() at time zone 'utc') - interval '2 minutes')
            )
          )
          and not exists (
            select 1
            from issue_run_event e
            where e.run_id = r.id
              and e.created_at > ((now() at time zone 'utc') - interval '2 minutes')
          )
          union all
          select r.id, 'tool_timeout'::text as reason
          from issue_run r
          join lateral (
            select e.event_type, e.created_at
            from issue_run_event e
            where e.run_id = r.id
            order by e.seq desc
            limit 1
          ) latest_event on true
          where r.status = 'running'
            and latest_event.event_type = 'issue_run:tool_started'
            and latest_event.created_at < ((now() at time zone 'utc') - interval '3 minutes')
        )
        select distinct on (id) id, reason
        from stale_runs
        order by id, reason
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
      reason: row.reason,
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
}): Promise<
  ResultValue<'restarted' | 'failed' | 'skipped', IssueRunReconcilerError>
> {
  const db = getDb(args.env)
  const maxAttempts = maxWakeupAttemptsForError(args.row.latest_run_error)
  if (args.row.attempt_count >= maxAttempts) {
    const failResult = await failWakeupAndBlockIssue({
      env: args.env,
      wakeupId: args.row.wakeup_id,
      reason: `attempts_exhausted:${args.row.latest_run_error ?? 'unknown'}`,
      now: args.now,
    })
    if (failResult.isErr()) return Result.err(failResult.error)
    return Result.ok('failed')
  }

  const runId = crypto.randomUUID()
  const nextAttemptCount = args.row.attempt_count + 1
  const createResult = await Result.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [activeRun] = await tx
          .select({ id: schema.issueRun.id })
          .from(schema.issueRun)
          .where(
            and(
              eq(schema.issueRun.wakeupId, args.row.wakeup_id),
              inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
            ),
          )
          .limit(1)

        if (activeRun) return false

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
            retryReason: args.row.latest_run_error ?? 'reconciler_retry',
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
        return true
      })
    },
    catch: (cause) => dbError('restart issue wakeup', cause),
  })
  if (createResult.isErr()) return Result.err(createResult.error)
  if (!createResult.value) return Result.ok('skipped')

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
          w.attempt_count,
          latest_run.error as latest_run_error
        from issue_wakeup w
        left join lateral (
          select r.error
          from issue_run r
          where r.wakeup_id = w.id
          order by r.created_at desc
          limit 1
        ) latest_run on true
        where w.status = 'claimed'
          and (w.next_attempt_at is null or w.next_attempt_at <= ${now})
          and not exists (
            select 1
            from issue_run r
            where r.wakeup_id = w.id
              and r.status in (${sqlTextList(LIVE_RUN_STATUSES)})
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

async function recoverStrandedTriggers(
  env: AppEnv,
  now: Date,
): Promise<ResultValue<number, IssueRunReconcilerError>> {
  const db = getDb(env)
  const strandedBefore = new Date(now.getTime() - 5 * 60 * 1000)
  const rowsResult = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<StrandedTriggerRow>(sql`
        select
          t.id as trigger_id,
          t.automation_id,
          a.concurrency_policy,
          t.next_run_at
        from automation_trigger t
        join automation a on a.id = t.automation_id
        where t.kind = 'schedule'
          and t.enabled = true
          and a.status = 'active'
          and t.next_run_at is not null
          and t.next_run_at < ${strandedBefore}
          and (t.last_fired_at is null or t.last_fired_at < t.next_run_at)
        order by t.next_run_at
        limit 50
      `)
      return rows.rows
    },
    catch: (cause) => dbError('load stranded automation triggers', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  let recovered = 0
  for (const row of rowsResult.value) {
    if (row.concurrency_policy === 'queue') continue
    if (
      row.concurrency_policy !== 'skip' &&
      row.concurrency_policy !== 'replace'
    ) {
      continue
    }
    const concurrencyPolicy = row.concurrency_policy

    const rawResult = await Result.tryPromise({
      try: async () =>
        (await env.AUTOMATION_TRIGGER.get(
          env.AUTOMATION_TRIGGER.idFromName(row.trigger_id),
        ).install({
          triggerId: row.trigger_id,
          automationId: row.automation_id,
          concurrencyPolicy,
          nextRunAt: row.next_run_at,
        })) as unknown,
      catch: (cause) => dbError('re-arm automation trigger', cause),
    })
    if (rawResult.isErr()) return Result.err(rawResult.error)

    const installResult = Result.deserialize<
      void,
      { message?: string; code?: string }
    >(rawResult.value)
    if (installResult.isErr()) {
      return Result.err(
        reconcilerError({
          code: 'automation_recovery_failed',
          message: installResult.error.message ?? 'Automation recovery failed.',
          cause: installResult.error,
        }),
      )
    }
    recovered += 1
  }

  return Result.ok(recovered)
}

function automationStatusForIssueRunStatus(status: string) {
  if ((LIVE_RUN_STATUSES as readonly string[]).includes(status)) {
    return 'running' as const
  }
  if (status === 'succeeded') return 'completed' as const
  return 'failed' as const
}

async function syncAutomationRuns(
  env: AppEnv,
  now: Date,
): Promise<ResultValue<number, IssueRunReconcilerError>> {
  const db = getDb(env)
  const rowsResult = await Result.tryPromise({
    try: async () => {
      const rows = await db.execute<AutomationRunSyncRow>(sql`
        select
          ar.id as automation_run_id,
          ir.status as issue_run_status,
          ir.error as issue_run_error,
          ir.finished_at as issue_run_finished_at
        from automation_run ar
        join issue_run ir on ir.id = ar.issue_run_id
        where ar.issue_run_id is not null
          and ar.status in ('issue_created', 'running')
          and (
            (ir.status in (${sqlTextList(LIVE_RUN_STATUSES)}) and ar.status <> 'running')
            or ir.status not in (${sqlTextList(LIVE_RUN_STATUSES)})
          )
        order by ar.triggered_at
        limit 100
      `)
      return rows.rows
    },
    catch: (cause) => dbError('load automation runs for sync', cause),
  })
  if (rowsResult.isErr()) return Result.err(rowsResult.error)

  let synced = 0
  for (const row of rowsResult.value) {
    const status = automationStatusForIssueRunStatus(row.issue_run_status)
    const completedAt =
      status === 'running' ? null : (row.issue_run_finished_at ?? now)
    const failureReason =
      status === 'failed'
        ? (row.issue_run_error ?? `issue_run_${row.issue_run_status}`)
        : null
    const updateResult = await Result.tryPromise({
      try: async () => {
        await db
          .update(schema.automationRun)
          .set({
            status,
            completedAt,
            failureReason,
          })
          .where(eq(schema.automationRun.id, row.automation_run_id))
      },
      catch: (cause) => dbError('sync automation run state', cause),
    })
    if (updateResult.isErr()) return Result.err(updateResult.error)
    synced += 1
  }

  return Result.ok(synced)
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
          body: exhaustedWakeupComment(args.reason),
          mentions: null,
        })
      })
    },
    catch: (cause) => dbError('fail wakeup and block issue', cause),
  })
  if (blockResult.isErr()) return Result.err(blockResult.error)

  return Result.ok()
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
          if (run.issueId) {
            await tx
              .update(schema.issue)
              .set({ activeRunId: null, updatedAt: now })
              .where(
                and(
                  eq(schema.issue.id, run.issueId),
                  eq(schema.issue.activeRunId, run.id),
                ),
              )
          }
        })
      },
      catch: (cause) => dbError('fail stale approval run', cause),
    })
    if (updateRunResult.isErr()) return Result.err(updateRunResult.error)

    if (!run.issueId) continue

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

  const triggersResult = await recoverStrandedTriggers(env, now)
  if (triggersResult.isErr()) {
    logger.error('recoverStrandedTriggers failed', triggersResult.error.message)
  }

  const automationRunsResult = await syncAutomationRuns(env, now)
  if (automationRunsResult.isErr()) {
    logger.error(
      'syncAutomationRuns failed',
      automationRunsResult.error.message,
    )
  }

  const approvalsResult = await sweepStaleApprovals(env, now)
  if (approvalsResult.isErr()) {
    logger.error('sweepStaleApprovals failed', approvalsResult.error.message)
  }

  return Result.ok({
    silentRunsReaped: silentResult.isOk() ? silentResult.value : 0,
    wakeupsRestarted: wakeupsResult.isOk() ? wakeupsResult.value.restarted : 0,
    wakeupsFailed: wakeupsResult.isOk() ? wakeupsResult.value.failed : 0,
    triggersRecovered: triggersResult.isOk() ? triggersResult.value : 0,
    automationRunsSynced: automationRunsResult.isOk()
      ? automationRunsResult.value
      : 0,
    approvalsExpired: approvalsResult.isOk() ? approvalsResult.value : 0,
  })
}
