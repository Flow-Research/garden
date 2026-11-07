import { and, eq, inArray } from 'drizzle-orm'
import {
  LIVE_RUN_STATUSES,
  cancelLiveRunsOnIssueChange,
} from '@garden/core/issues/run-sync'
import type { IssueStatus } from '@garden/core/types/issue'
import { archiveTerminalIssueInbox } from '@garden/db/inbox'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import {
  cancelIssueRun,
  startIssueRun,
  type IssueRunEnv,
} from '@garden/server/issues/run-service'
import { getWorkspaceIssuePrefix, toIssue } from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import { publishWorkspaceEvent } from '@/lib/server/realtime'
import type { AppEnv } from '@/lib/server/env'

const logger = createGardenLogger({
  service: 'garden',
  component: 'issue-mutation-effects',
})

/** Issue fields read before a write, used to decide lifecycle effects. */
export type IssueLifecycleSnapshot = {
  status: string | null
  assigneeType: string | null
  assigneeId: string | null
}

/**
 * Runs the effects that follow a committed issue write and returns the API
 * issue to send back.
 *
 * Why: the GitHub webhook used to patch `issue.status` alone, so a close from
 * GitHub skipped the inbox archive, live-run cancel, and `issue:updated`
 * publish that `PUT /api/issues/$id` performs. Both callers now share this
 * helper, so the effects cannot drift apart. Call it only after the write's
 * transaction commits: clients refetch on the realtime event, and a
 * cancelled run must not outlive a rolled-back write.
 */
export async function applyIssueMutationSideEffects(args: {
  db: Db
  env: AppEnv & IssueRunEnv
  waitUntil: (promise: Promise<unknown>) => void
  workspaceId: string
  previous: IssueLifecycleSnapshot
  nextIssue: typeof schema.issue.$inferSelect
  actor: { type: 'member' | 'agent' | 'system'; id: string }
  /** Assignment wake — API only; webhook close/reopen does not need it. */
  wakeOnAssignment?: boolean
}): Promise<ReturnType<typeof toIssue>> {
  const nextStatus = (args.nextIssue.status ?? 'todo') as IssueStatus
  if (nextStatus === 'done' || nextStatus === 'cancelled') {
    await archiveTerminalIssueInbox({
      db: args.db,
      workspaceId: args.workspaceId,
      issueId: args.nextIssue.id,
    })
  }

  const syncDecision = cancelLiveRunsOnIssueChange({
    currentStatus: (args.previous.status ?? 'todo') as IssueStatus,
    nextStatus,
    currentAssigneeType: args.previous.assigneeType as
      | 'user'
      | 'member'
      | 'agent'
      | null,
    currentAssigneeId: args.previous.assigneeId,
    nextAssigneeType: args.nextIssue.assigneeType as
      | 'user'
      | 'member'
      | 'agent'
      | null,
    nextAssigneeId: args.nextIssue.assigneeId,
  })

  if (syncDecision.cancelLiveRuns) {
    const liveRuns = await args.db
      .select({ id: schema.issueRun.id })
      .from(schema.issueRun)
      .where(
        and(
          eq(schema.issueRun.issueId, args.nextIssue.id),
          inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
          ...(syncDecision.cancelAgentId
            ? [eq(schema.issueRun.agentId, syncDecision.cancelAgentId)]
            : []),
        ),
      )
    for (const run of liveRuns) {
      const cancelResult = await cancelIssueRun(args.env, {
        workspaceId: args.workspaceId,
        runId: run.id,
        actor: args.actor,
        reason: 'issue_changed',
      })
      if (cancelResult.isErr()) {
        logger.error('issue.run_cancel_failed', errorFields(cancelResult.error))
      }
    }
  }

  if (
    args.wakeOnAssignment &&
    syncDecision.shouldWakeAgent &&
    args.nextIssue.assigneeId
  ) {
    const startResult = await startIssueRun(args.env, {
      workspaceId: args.workspaceId,
      issueId: args.nextIssue.id,
      agentId: args.nextIssue.assigneeId,
      source: 'assignment',
      actor: args.actor,
    })
    if (startResult.isErr()) {
      logger.error('issue.run_start_failed', errorFields(startResult.error))
    }
  }

  const issuePrefix = await getWorkspaceIssuePrefix(args.db, args.workspaceId)
  const updatedIssue = toIssue(args.nextIssue, { issuePrefix })
  args.waitUntil(
    publishWorkspaceEvent(args.env, args.workspaceId, {
      type: 'issue:updated',
      payload: { issue: updatedIssue },
    }),
  )
  return updatedIssue
}

/** Publishes comment created/updated/deleted after a successful write. */
export function publishCommentChangedEvent(args: {
  env: AppEnv
  waitUntil: (promise: Promise<unknown>) => void
  workspaceId: string
  action: 'created' | 'updated' | 'deleted'
  issueId: string
  commentId: string
  teamId: string | null
  assigneeId: string | null
}): void {
  args.waitUntil(
    publishWorkspaceEvent(args.env, args.workspaceId, {
      type: `comment:${args.action}`,
      payload: {
        issue_id: args.issueId,
        comment_id: args.commentId,
        team_id: args.teamId,
        assignee_id: args.assigneeId,
      },
    }),
  )
}
