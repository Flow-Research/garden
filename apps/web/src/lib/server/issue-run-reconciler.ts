import { and, desc, eq, sql } from 'drizzle-orm'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { createLogger } from '@garden/observability/console'
import type { AppEnv } from '@/lib/server/env'
import { getDb, schema } from '@/lib/server/db'

const logger = createLogger('issue-run-reconciler')

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

export type ReconcileReport = {
  approvalsExpired: number
}

export class IssueRunReconcilerError extends TaggedError(
  'IssueRunReconcilerError',
)<{
  code: 'approval_sweep_failed' | 'db_error' | 'reconcile_failed'
  message: string
  cause?: unknown
}>() {}

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

function pendingAgentIdFromContext(value: string | null) {
  const prefix = 'agent_proposal:'
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null
}

/**
 * Expires human approval requests that no durable platform primitive can finish
 * for us. Runtime liveness is handled by Workflows, Think submissions, and SDK
 * schedules; this pass only repairs Garden product rows after approval TTL.
 */
async function sweepStaleApprovals(
  env: AppEnv,
  now: Date,
): Promise<ResultValue<number, IssueRunReconcilerError>> {
  const db = await getDb(env)
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

/**
 * Runs product-ledger reconciliation after SDK-native runtime primitives took
 * over run recovery and schedule dispatch. Keep this intentionally narrow so it
 * cannot race Workflow or Agents SDK ownership of live execution.
 */
export async function reconcile(
  env: AppEnv,
): Promise<ResultValue<ReconcileReport, IssueRunReconcilerError>> {
  // Workflow, Think submissions, and SDK schedules own runtime recovery.
  // This reconciler now handles only product-ledger cleanup that has no durable
  // platform primitive: stale approval expiry.
  const now = new Date()

  const approvalsResult = await sweepStaleApprovals(env, now)
  if (approvalsResult.isErr()) {
    logger.error('sweepStaleApprovals failed', approvalsResult.error.message)
  }

  return Result.ok({
    approvalsExpired: approvalsResult.isOk() ? approvalsResult.value : 0,
  })
}
