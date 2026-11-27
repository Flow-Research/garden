import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import type { RunWorkflowWait } from './run-workflow'

/**
 * `decide_analysis_run` transitions shared by the web service and the
 * automation run facet. The service owns the run lifecycle; the facet only
 * needs to read its own run's analyses and request a cancel, and it lives in
 * a different Worker module, so both import these instead of copying the
 * lock key and the cancel rules.
 */

const ACTIVE_STATUSES = ['queued', 'running', 'cancel_requested'] as const
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const

export const isTerminalDecideAnalysisStatus = (status: string) =>
  (TERMINAL_STATUSES as readonly string[]).includes(status)

/**
 * Serializes writes to one Decide run. Claim, provider start, progress,
 * finish, and cancel all take it, so a cancel can never be overwritten by a
 * claim that read `queued` a moment earlier.
 */
export const decideAnalysisRunLock = (runId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`decide-analysis:${runId}`}))`

type RunRow = typeof schema.decideAnalysisRun.$inferSelect

/**
 * Requests cancellation without pretending the provider stopped: a queued
 * run is cancelled at once, and a running one becomes `cancel_requested`
 * until its Workflow commits. Call inside a transaction that holds
 * `decideAnalysisRunLock(row.id)`. Returns the row after the transition.
 */
export async function requestDecideAnalysisCancel(
  tx: Pick<Db, 'update'>,
  row: RunRow,
): Promise<RunRow> {
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
}

const ownedByRun = (automationRunId: string) =>
  eq(schema.decideAnalysisRun.automationRunId, automationRunId)

/**
 * The analysis an automation turn left its run waiting on: the latest one
 * the agent has not been handed yet (`delivered_at` is null). It may already
 * be terminal when Decide finished during the turn, and then the Workflow
 * skips the wait.
 */
export async function readAutomationDecideWait(
  db: Db,
  automationRunId: string,
): Promise<RunWorkflowWait | null> {
  const [row] = await db
    .select({
      id: schema.decideAnalysisRun.id,
      status: schema.decideAnalysisRun.status,
    })
    .from(schema.decideAnalysisRun)
    .where(
      and(
        ownedByRun(automationRunId),
        isNull(schema.decideAnalysisRun.deliveredAt),
      ),
    )
    .orderBy(desc(schema.decideAnalysisRun.createdAt))
    .limit(1)
  return row
    ? {
        kind: 'decide_analysis',
        decideRunId: row.id,
        settled: isTerminalDecideAnalysisStatus(row.status),
      }
    : null
}

/**
 * Milliseconds an automation run spent paused on its Decide analyses: from
 * each analysis's creation to its completion, or to now while it runs. The
 * run's turn ends when an analysis starts, so this is time the agent did
 * not work.
 */
export async function automationDecidePausedMs(
  db: Db,
  automationRunId: string,
): Promise<number> {
  const [row] = await db
    .select({
      pausedMs: sql<
        string | null
      >`extract(epoch from sum(coalesce(${schema.decideAnalysisRun.completedAt}, now()) - ${schema.decideAnalysisRun.createdAt})) * 1000`,
    })
    .from(schema.decideAnalysisRun)
    .where(ownedByRun(automationRunId))
  const pausedMs = Number(row?.pausedMs ?? 0)
  return Number.isFinite(pausedMs) && pausedMs > 0 ? pausedMs : 0
}

/**
 * Requests cancel on an automation run's active analysis, if it has one,
 * and returns that analysis's ID so the caller can wake the waiting
 * Workflow.
 */
export async function cancelActiveAutomationDecideAnalysis(
  db: Db,
  automationRunId: string,
): Promise<string | null> {
  const [active] = await db
    .select({ id: schema.decideAnalysisRun.id })
    .from(schema.decideAnalysisRun)
    .where(
      and(
        ownedByRun(automationRunId),
        inArray(schema.decideAnalysisRun.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1)
  if (!active) return null
  await db.transaction(async (tx) => {
    await tx.execute(decideAnalysisRunLock(active.id))
    const [row] = await tx
      .select()
      .from(schema.decideAnalysisRun)
      .where(eq(schema.decideAnalysisRun.id, active.id))
      .limit(1)
    if (row) await requestDecideAnalysisCancel(tx, row)
  })
  return active.id
}

/**
 * Hands one analysis to its automation run's resume turn. Reads the run as
 * it is; when it is still active (the Workflow wait timed out) it requests
 * cancel, so Garden stops paying attention to a run nobody will read. Then
 * it records `delivered_at`, so the run never waits on this analysis again.
 * Returns null when the analysis does not belong to the run.
 */
export async function takeAutomationDecideOutcome(
  db: Db,
  input: { automationRunId: string; decideRunId: string },
): Promise<{ status: string; resultJson: unknown; errorJson: unknown } | null> {
  return await db.transaction(async (tx) => {
    await tx.execute(decideAnalysisRunLock(input.decideRunId))
    const [row] = await tx
      .select()
      .from(schema.decideAnalysisRun)
      .where(
        and(
          eq(schema.decideAnalysisRun.id, input.decideRunId),
          ownedByRun(input.automationRunId),
        ),
      )
      .limit(1)
    if (!row) return null
    if (!isTerminalDecideAnalysisStatus(row.status)) {
      await requestDecideAnalysisCancel(tx, row)
    }
    await tx
      .update(schema.decideAnalysisRun)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          eq(schema.decideAnalysisRun.id, row.id),
          isNull(schema.decideAnalysisRun.deliveredAt),
        ),
      )
    return {
      status: row.status,
      resultJson: row.resultJson,
      errorJson: row.errorJson,
    }
  })
}
