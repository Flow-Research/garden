import { and, desc, eq, sql } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { CronExpressionParser } from 'cron-parser'
import { createLogger } from '@garden/core/logger'
import type { AppEnv } from '@/lib/server/env'
import { getDb, schema } from '@/lib/server/db'

const logger = createLogger('issue-run-reconciler')

function nextRunFromCronInline(args: {
  cronExpression: string
  timezone: string
  from: Date
}): ResultValue<Date, string> {
  return Result.try({
    try: () =>
      CronExpressionParser.parse(args.cronExpression, {
        currentDate: args.from,
        tz: args.timezone,
      })
        .next()
        .toDate(),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  })
}

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

export type ReconcileReport = {
  silentRunsReaped: number
  triggersRecovered: number
  approvalsExpired: number
}

export class IssueRunReconcilerError extends TaggedError(
  'IssueRunReconcilerError',
)<{
  code:
    | 'approval_sweep_failed'
    | 'automation_recovery_failed'
    | 'db_error'
    | 'reconcile_failed'
    | 'run_not_found'
  message: string
  cause?: unknown
}>() {}

type SilentRunRow = {
  id: string
  reason: string
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
  cron_expression: string | null
  timezone: string | null
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
        })
        .from(schema.issueRun)
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

  const issueId = row.issueId
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
              eq(schema.issue.id, issueId),
              eq(schema.issue.activeRunId, args.runId),
            ),
          )
      })
    },
    catch: (cause) => dbError('mark run failed', cause),
  })
  if (updateResult.isErr()) return Result.err(updateResult.error)

  const eventResult = await Result.tryPromise({
    try: async () => {
      await db.insert(schema.issueRunEvent).values({
        id: crypto.randomUUID(),
        workspaceId: row.workspaceId,
        issueId,
        runId: args.runId,
        seq: sql<number>`(
          select cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)
          from ${schema.issueRunEvent}
          where ${schema.issueRunEvent.runId} = ${args.runId}::uuid
        )`,
        eventType: 'issue_run:failed',
        stream: 'system',
        level: 'error',
        message: 'Run failed during reconciliation',
        payload: { reason: args.reason },
      })
    },
    catch: (cause) => dbError('append run failure event', cause),
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
          t.cron_expression,
          t.timezone
        from automation_trigger t
        join automation a on a.id = t.automation_id
        where t.kind = 'schedule'
          and t.enabled = true
          and a.status = 'active'
          and t.cron_expression is not null
          and t.timezone is not null
        order by t.id
        limit 200
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
    if (!row.cron_expression || !row.timezone) continue
    const concurrencyPolicy = row.concurrency_policy

    const stub = env.AUTOMATION_TRIGGER.get(
      env.AUTOMATION_TRIGGER.idFromName(row.trigger_id),
    )

    const describeResult = await Result.tryPromise({
      try: async () => (await stub.describe()) as unknown,
      catch: (cause) => dbError('describe automation trigger', cause),
    })
    if (describeResult.isErr()) return Result.err(describeResult.error)

    const description = describeResult.value as {
      nextRunAt?: Date | string | null
    } | null
    const currentAlarm = description?.nextRunAt
      ? new Date(description.nextRunAt)
      : null
    if (currentAlarm && currentAlarm.getTime() > strandedBefore.getTime()) {
      continue
    }

    const nextResult = nextRunFromCronInline({
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      from: now,
    })
    if (nextResult.isErr()) {
      logger.warn('cron parse failed during recovery', {
        triggerId: row.trigger_id,
        error: nextResult.error,
      })
      continue
    }

    const rawResult = await Result.tryPromise({
      try: async () =>
        (await stub.install({
          triggerId: row.trigger_id,
          automationId: row.automation_id,
          concurrencyPolicy,
          nextRunAt: nextResult.value,
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

    const runIssueId = run.issueId
    if (!runIssueId) continue

    const eventResult = await Result.tryPromise({
      try: async () => {
        await db.insert(schema.issueRunEvent).values({
          id: crypto.randomUUID(),
          workspaceId: run.workspaceId,
          issueId: runIssueId,
          runId: run.id,
          seq: sql<number>`(
            select cast(coalesce(max(${schema.issueRunEvent.seq}), 0) + 1 as int)
            from ${schema.issueRunEvent}
            where ${schema.issueRunEvent.runId} = ${run.id}::uuid
          )`,
          eventType: 'issue_run:reconciler_action',
          stream: 'system',
          level: 'warn',
          message: 'Approval request expired',
          payload: {
            permission_request_id: row.id,
            reason: 'stale_approval',
          },
        })
      },
      catch: (cause) => dbError('append stale approval event', cause),
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

  const triggersResult = await recoverStrandedTriggers(env, now)
  if (triggersResult.isErr()) {
    logger.error('recoverStrandedTriggers failed', triggersResult.error.message)
  }

  const approvalsResult = await sweepStaleApprovals(env, now)
  if (approvalsResult.isErr()) {
    logger.error('sweepStaleApprovals failed', approvalsResult.error.message)
  }

  return Result.ok({
    silentRunsReaped: silentResult.isOk() ? silentResult.value : 0,
    triggersRecovered: triggersResult.isOk() ? triggersResult.value : 0,
    approvalsExpired: approvalsResult.isOk() ? approvalsResult.value : 0,
  })
}
