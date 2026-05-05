import { and, desc, eq, inArray, ne, or } from 'drizzle-orm'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import type {
  InboxItem,
  InboxItemType,
  InboxSeverity,
  IssueStatus,
} from '@garden/core/types'

type IssueRow = typeof schema.issue.$inferSelect
type CommentRow = typeof schema.issueComment.$inferSelect
type RunRow = typeof schema.issueRun.$inferSelect
type WorkProductRow = typeof schema.issueWorkProduct.$inferSelect
type PermissionRequestRow = typeof schema.permissionRequest.$inferSelect

type SourceItem = {
  key: string
  type: InboxItemType
  severity: InboxSeverity
  issueId: string | null
  title: string
  body: string | null
  issueStatus: IssueStatus | null
  actorType: 'member' | 'agent' | null
  actorId: string | null
  activityAt: Date
  details: Record<string, string>
}

const TRUNCATE_BODY = 200

function truncate(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length <= TRUNCATE_BODY) return trimmed
  return `${trimmed.slice(0, TRUNCATE_BODY - 1)}…`
}

function pickIssueStatus(value: string | null): IssueStatus | null {
  if (!value) return null
  return value as IssueStatus
}

function preferDate(...values: Array<Date | null | undefined>): Date {
  for (const value of values) {
    if (value) return value
  }
  return new Date()
}

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]))
}

function commentMentionsUser(mentions: unknown, userId: string): boolean {
  if (!mentions || typeof mentions !== 'object') return false
  const users = (mentions as { users?: unknown }).users
  return Array.isArray(users) && users.includes(userId)
}

function actorFromComment(row: CommentRow): {
  actorType: 'member' | 'agent' | null
  actorId: string | null
} {
  const type =
    row.authorType === 'user'
      ? 'member'
      : row.authorType === 'agent'
        ? 'agent'
        : null
  return { actorType: type, actorId: type ? row.authorId : null }
}

function actorFromAgentId(agentId: string | null): {
  actorType: 'member' | 'agent' | null
  actorId: string | null
} {
  if (!agentId) return { actorType: null, actorId: null }
  return { actorType: 'agent', actorId: agentId }
}

function buildAssignedSource(
  issue: IssueRow,
  userId: string,
): SourceItem | null {
  if (issue.assigneeType !== 'user' || issue.assigneeId !== userId) return null
  const activityAt = preferDate(issue.updatedAt, issue.createdAt)
  return {
    key: `assigned:${issue.id}`,
    type: 'issue_assigned',
    severity: 'action_required',
    issueId: issue.id,
    title: `You were assigned to ${issue.title}`,
    body: truncate(issue.description),
    issueStatus: pickIssueStatus(issue.status),
    actorType: null,
    actorId: null,
    activityAt,
    details: {
      issue_number: String(issue.number),
      priority: issue.priority ?? 'medium',
      status: issue.status ?? 'backlog',
    },
  }
}

function buildBlockedSource(issue: IssueRow): SourceItem | null {
  if (issue.status !== 'blocked') return null
  const activityAt = preferDate(issue.updatedAt, issue.createdAt)
  const actor =
    issue.assigneeType === 'agent'
      ? actorFromAgentId(issue.assigneeId)
      : { actorType: null, actorId: null }
  return {
    key: `blocked:${issue.id}`,
    type: 'agent_blocked',
    severity: 'action_required',
    issueId: issue.id,
    title: `${issue.title} is blocked`,
    body: truncate(issue.description),
    issueStatus: pickIssueStatus(issue.status),
    ...actor,
    activityAt,
    details: {
      issue_number: String(issue.number),
      status: issue.status ?? 'blocked',
    },
  }
}

function buildMentionSource(
  comment: CommentRow,
  issue: IssueRow,
): SourceItem {
  const activityAt = preferDate(comment.createdAt)
  const { actorType, actorId } = actorFromComment(comment)
  return {
    key: `mention:${comment.id}`,
    type: 'mentioned',
    severity: 'action_required',
    issueId: issue.id,
    title: `Mentioned on ${issue.title}`,
    body: truncate(comment.body),
    issueStatus: pickIssueStatus(issue.status),
    actorType,
    actorId,
    activityAt,
    details: {
      issue_number: String(issue.number),
      comment_id: comment.id,
    },
  }
}

function buildCommentSource(
  comment: CommentRow,
  issue: IssueRow,
): SourceItem {
  const activityAt = preferDate(comment.createdAt)
  const { actorType, actorId } = actorFromComment(comment)
  return {
    key: `comment:${comment.id}`,
    type: 'new_comment',
    severity: 'attention',
    issueId: issue.id,
    title: `New comment on ${issue.title}`,
    body: truncate(comment.body),
    issueStatus: pickIssueStatus(issue.status),
    actorType,
    actorId,
    activityAt,
    details: {
      issue_number: String(issue.number),
      comment_id: comment.id,
    },
  }
}

function buildApprovalSource(
  request: PermissionRequestRow,
  issue: IssueRow | undefined,
): SourceItem | null {
  if (request.status !== 'pending') return null
  const activityAt = preferDate(request.requestedAt)
  const titleSuffix = issue ? ` on ${issue.title}` : ''
  return {
    key: `approval:${request.id}`,
    type: 'review_requested',
    severity: 'action_required',
    issueId: issue?.id ?? null,
    title: `Approval needed${titleSuffix}`,
    body: truncate(request.context ?? null),
    issueStatus: issue ? pickIssueStatus(issue.status) : null,
    ...actorFromAgentId(request.agentId),
    activityAt,
    details: {
      kind: 'approval',
      request_id: request.id,
      ...(issue ? { issue_number: String(issue.number) } : {}),
    },
  }
}

function buildWaitingForInputSource(
  run: RunRow,
  issue: IssueRow,
): SourceItem {
  const activityAt = preferDate(run.updatedAt, run.startedAt, run.createdAt)
  return {
    key: `waiting_for_input:${run.id}`,
    type: 'waiting_for_input',
    severity: 'action_required',
    issueId: issue.id,
    title: `Garden is waiting on you on ${issue.title}`,
    body: truncate(run.error ?? null),
    issueStatus: pickIssueStatus(issue.status),
    ...actorFromAgentId(run.agentId),
    activityAt,
    details: {
      kind: 'waiting_for_input',
      run_id: run.id,
      issue_number: String(issue.number),
    },
  }
}

function buildWorkProductReviewSource(
  wp: WorkProductRow,
  issue: IssueRow,
): SourceItem {
  const activityAt = preferDate(wp.updatedAt, wp.createdAt)
  const title = wp.title?.trim() || `${wp.type} ready`
  return {
    key: `wp_review:${wp.id}`,
    type: 'wp_review',
    severity: 'action_required',
    issueId: issue.id,
    title: `${title} on ${issue.title}`,
    body: truncate(wp.body),
    issueStatus: pickIssueStatus(issue.status),
    ...actorFromAgentId(wp.agentId),
    activityAt,
    details: {
      kind: 'wp_review',
      work_product_id: wp.id,
      work_product_type: wp.type,
      issue_number: String(issue.number),
    },
  }
}

function buildFailedRunSource(
  run: RunRow,
  issue: IssueRow,
): SourceItem {
  const activityAt = preferDate(run.finishedAt, run.updatedAt, run.createdAt)
  return {
    key: `failed_run:${run.id}`,
    type: 'task_failed',
    severity: 'attention',
    issueId: issue.id,
    title: `A run failed on ${issue.title}`,
    body: truncate(run.error ?? null),
    issueStatus: pickIssueStatus(issue.status),
    ...actorFromAgentId(run.agentId),
    activityAt,
    details: {
      run_id: run.id,
      issue_number: String(issue.number),
    },
  }
}

function userIsResponsible(issue: IssueRow, userId: string): boolean {
  return issue.createdBy === userId || issue.assigneeId === userId
}

function toInboxItem(
  source: SourceItem,
  args: {
    workspaceId: string
    userId: string
    dismissedAt: Date | null
  },
): InboxItem {
  const dismissed = args.dismissedAt
    ? args.dismissedAt.getTime() >= source.activityAt.getTime()
    : false
  return {
    id: source.key,
    workspace_id: args.workspaceId,
    recipient_type: 'member',
    recipient_id: args.userId,
    actor_type: source.actorType,
    actor_id: source.actorId,
    type: source.type,
    severity: source.severity,
    issue_id: source.issueId,
    title: source.title,
    body: source.body,
    issue_status: source.issueStatus,
    read: dismissed,
    archived: dismissed,
    created_at: source.activityAt.toISOString(),
    details: source.details,
  }
}

export async function computeInboxItems(args: {
  workspaceId: string
  userId: string
  limit?: number
}): Promise<InboxItem[]> {
  const limit = args.limit ?? 100
  const db = getDb(appEnv)
  const { workspaceId, userId } = args

  const [
    workspaceIssues,
    workspaceComments,
    approvalRows,
    pendingWorkProducts,
    pausedRuns,
    failedRuns,
    dismissalRows,
  ] = await Promise.all([
    db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.workspaceId, workspaceId)),
    db
      .select({
        id: schema.issueComment.id,
        issueId: schema.issueComment.issueId,
        authorType: schema.issueComment.authorType,
        authorId: schema.issueComment.authorId,
        body: schema.issueComment.body,
        mentions: schema.issueComment.mentions,
        createdAt: schema.issueComment.createdAt,
      })
      .from(schema.issueComment)
      .innerJoin(
        schema.issue,
        eq(schema.issue.id, schema.issueComment.issueId),
      )
      .where(
        and(
          eq(schema.issue.workspaceId, workspaceId),
          or(
            ne(schema.issueComment.authorType, 'user'),
            ne(schema.issueComment.authorId, userId),
          ),
        ),
      )
      .orderBy(desc(schema.issueComment.createdAt))
      .limit(300),
    db
      .select()
      .from(schema.permissionRequest)
      .where(eq(schema.permissionRequest.status, 'pending'))
      .orderBy(desc(schema.permissionRequest.requestedAt))
      .limit(50),
    db
      .select()
      .from(schema.issueWorkProduct)
      .where(
        and(
          eq(schema.issueWorkProduct.workspaceId, workspaceId),
          eq(schema.issueWorkProduct.status, 'review'),
          eq(schema.issueWorkProduct.reviewState, 'pending'),
        ),
      )
      .orderBy(desc(schema.issueWorkProduct.updatedAt))
      .limit(100),
    db
      .select()
      .from(schema.issueRun)
      .where(
        and(
          eq(schema.issueRun.workspaceId, workspaceId),
          eq(schema.issueRun.status, 'waiting_for_input'),
        ),
      )
      .orderBy(desc(schema.issueRun.updatedAt))
      .limit(100),
    db
      .select()
      .from(schema.issueRun)
      .where(
        and(
          eq(schema.issueRun.workspaceId, workspaceId),
          eq(schema.issueRun.status, 'failed'),
        ),
      )
      .orderBy(desc(schema.issueRun.finishedAt))
      .limit(100),
    db
      .select()
      .from(schema.inboxDismissal)
      .where(
        and(
          eq(schema.inboxDismissal.workspaceId, workspaceId),
          eq(schema.inboxDismissal.userId, userId),
        ),
      ),
  ])

  const issuesById = indexById(workspaceIssues)
  const dismissalsByKey = new Map(
    dismissalRows.map((row) => [row.itemKey, row.dismissedAt ?? new Date()]),
  )

  const sources: SourceItem[] = []

  for (const issue of workspaceIssues) {
    const assigned = buildAssignedSource(issue, userId)
    if (assigned) sources.push(assigned)
    if (issue.status === 'blocked' && userIsResponsible(issue, userId)) {
      const blocked = buildBlockedSource(issue)
      if (blocked) sources.push(blocked)
    }
  }

  for (const comment of workspaceComments) {
    const issue = issuesById.get(comment.issueId)
    if (!issue) continue
    const row = comment as CommentRow
    if (commentMentionsUser(row.mentions, userId)) {
      sources.push(buildMentionSource(row, issue))
      continue
    }
    if (userIsResponsible(issue, userId)) {
      sources.push(buildCommentSource(row, issue))
    }
  }

  const approvalIssueIds = approvalRows
    .map((row) => row.issueId)
    .filter((id): id is string => Boolean(id))
  const approvalIssues =
    approvalIssueIds.length === 0
      ? new Map<string, IssueRow>()
      : indexById(
          await db
            .select()
            .from(schema.issue)
            .where(
              and(
                eq(schema.issue.workspaceId, workspaceId),
                inArray(schema.issue.id, approvalIssueIds),
              ),
            ),
        )
  for (const request of approvalRows) {
    const issue = request.issueId ? approvalIssues.get(request.issueId) : undefined
    if (request.issueId && !issue) continue
    const item = buildApprovalSource(request, issue)
    if (item) sources.push(item)
  }

  for (const wp of pendingWorkProducts) {
    const issue = issuesById.get(wp.issueId)
    if (!issue) continue
    sources.push(buildWorkProductReviewSource(wp, issue))
  }

  for (const run of pausedRuns) {
    const issue = issuesById.get(run.issueId)
    if (!issue || !userIsResponsible(issue, userId)) continue
    sources.push(buildWaitingForInputSource(run, issue))
  }

  for (const run of failedRuns) {
    const issue = issuesById.get(run.issueId)
    if (!issue || !userIsResponsible(issue, userId)) continue
    sources.push(buildFailedRunSource(run, issue))
  }

  return sources
    .sort(
      (left, right) => right.activityAt.getTime() - left.activityAt.getTime(),
    )
    .slice(0, limit)
    .map((source) =>
      toInboxItem(source, {
        workspaceId,
        userId,
        dismissedAt: dismissalsByKey.get(source.key) ?? null,
      }),
    )
}

export async function computeInboxUnreadCount(args: {
  workspaceId: string
  userId: string
}): Promise<number> {
  const items = await computeInboxItems(args)
  return items.filter((item) => !item.read).length
}
