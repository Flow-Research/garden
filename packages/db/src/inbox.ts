import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { GardenDatabase } from './client.js'
import * as schema from './schema/index.js'

type GardenDb = GardenDatabase

type InboxActorType = 'member' | 'agent' | null
type InboxSeverity = 'action_required' | 'attention' | 'info'
type InboxItemType =
  | 'issue_assigned'
  | 'mentioned'
  | 'new_comment'
  | 'agent_blocked'
  | 'review_requested'
  | 'task_failed'
  | 'waiting_for_input'
  | 'wp_review'

type InboxWrite = {
  workspaceId: string
  recipientId: string
  itemKey: string
  type: InboxItemType
  severity: InboxSeverity
  issueId: string | null
  issueStatus: string | null
  title: string
  body?: string | null
  actorType?: InboxActorType
  actorId?: string | null
  details?: Record<string, string>
  activityAt?: Date
}

const TRUNCATE_BODY = 200

function truncate(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length <= TRUNCATE_BODY) return trimmed
  return `${trimmed.slice(0, TRUNCATE_BODY - 1)}…`
}

function preferDate(...values: Array<Date | null | undefined>): Date {
  for (const value of values) {
    if (value) return value
  }
  return new Date()
}

async function upsertInboxItem(db: GardenDb, item: InboxWrite): Promise<void> {
  const now = new Date()
  const activityAt = item.activityAt ?? now
  await db
    .insert(schema.inboxItem)
    .values({
      id: randomUUID(),
      workspaceId: item.workspaceId,
      recipientType: 'member',
      recipientId: item.recipientId,
      itemKey: item.itemKey,
      actorType: item.actorType ?? null,
      actorId: item.actorId ?? null,
      type: item.type,
      severity: item.severity,
      issueId: item.issueId,
      issueStatus: item.issueStatus,
      title: item.title,
      body: item.body ?? null,
      details: item.details ?? {},
      activityAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.inboxItem.workspaceId,
        schema.inboxItem.recipientType,
        schema.inboxItem.recipientId,
        schema.inboxItem.itemKey,
      ],
      set: {
        actorType: sql`excluded.actor_type`,
        actorId: sql`excluded.actor_id`,
        type: sql`excluded.type`,
        severity: sql`excluded.severity`,
        issueId: sql`excluded.issue_id`,
        issueStatus: sql`excluded.issue_status`,
        title: sql`excluded.title`,
        body: sql`excluded.body`,
        details: sql`excluded.details`,
        read: sql`case when excluded.activity_at > ${schema.inboxItem.activityAt} then false else ${schema.inboxItem.read} end`,
        archived: sql`case when excluded.activity_at > ${schema.inboxItem.activityAt} then false else ${schema.inboxItem.archived} end`,
        activityAt: sql`greatest(${schema.inboxItem.activityAt}, excluded.activity_at)`,
        updatedAt: now,
      },
    })
}

async function workspaceMemberIds(
  db: GardenDb,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.organizationId, workspaceId))
  return rows.map((row) => row.userId)
}

/**
 * Permission approvals are actionable only for owner/admin roles because those
 * roles map to Better Auth `permission.approve` / `permission.grant`. Before
 * this filter every member received an approval card, then non-approvers hit a
 * forbidden or missing-request path after stale cleanup.
 */
async function workspacePermissionApproverIds(
  db: GardenDb,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspaceId),
        inArray(schema.member.role, ['owner', 'admin']),
      ),
    )
  return rows.map((row) => row.userId)
}

async function issueRecipientIds(
  db: GardenDb,
  issue: typeof schema.issue.$inferSelect,
  excludeIds: string[] = [],
): Promise<string[]> {
  const recipients = new Set<string>()
  recipients.add(issue.createdBy)
  if (issue.assigneeType === 'user' && issue.assigneeId) {
    recipients.add(issue.assigneeId)
  }
  for (const excludeId of excludeIds) {
    recipients.delete(excludeId)
  }

  if (recipients.size > 0) return Array.from(recipients)

  const members = await workspaceMemberIds(db, issue.workspaceId)
  for (const memberId of members) {
    if (!excludeIds.includes(memberId)) recipients.add(memberId)
  }
  return Array.from(recipients)
}

async function isActiveWorkspaceUser(
  db: GardenDb,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspaceId),
        eq(schema.member.userId, userId),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Recipient order for Team-linked inbox items, per the Teams spec:
 * agent owner → linked issue assignee → Team owner → workspace owner/admin.
 * Every step must resolve to an active workspace user, the first eligible
 * recipient wins, and a single recipient makes duplicates impossible.
 *
 * Applied at the push writers that exist today: review_requested,
 * waiting_for_input, and wp_review. agent_blocked and task_failed only exist
 * on the unreferenced compute path, so they are intentionally untouched until
 * they gain push writers.
 */
async function teamItemRecipientId(
  db: GardenDb,
  args: {
    workspaceId: string
    teamId: string
    agentId: string | null
    issue: typeof schema.issue.$inferSelect | null
    excludeIds: string[]
  },
): Promise<string | null> {
  const eligible = async (userId: string | null | undefined) => {
    if (!userId) return false
    if (args.excludeIds.includes(userId)) return false
    return await isActiveWorkspaceUser(db, args.workspaceId, userId)
  }

  if (args.agentId) {
    const [agent] = await db
      .select({ ownerUserId: schema.agent.ownerUserId })
      .from(schema.agent)
      .where(
        and(
          eq(schema.agent.id, args.agentId),
          eq(schema.agent.workspaceId, args.workspaceId),
        ),
      )
      .limit(1)
    if (agent && (await eligible(agent.ownerUserId))) return agent.ownerUserId
  }

  if (
    args.issue?.assigneeType === 'user' &&
    (await eligible(args.issue.assigneeId))
  ) {
    return args.issue.assigneeId
  }

  const [team] = await db
    .select({ ownerUserId: schema.team.ownerUserId })
    .from(schema.team)
    .where(
      and(
        eq(schema.team.id, args.teamId),
        eq(schema.team.workspaceId, args.workspaceId),
      ),
    )
    .limit(1)
  if (team && (await eligible(team.ownerUserId))) return team.ownerUserId

  const approvers = await workspacePermissionApproverIds(db, args.workspaceId)
  for (const approverId of approvers) {
    if (!args.excludeIds.includes(approverId)) return approverId
  }
  return null
}

/**
 * Issue-scoped recipients: Team issues use the Team routing order; workspace
 * issues keep the existing creator + assignee behavior.
 */
async function resolveIssueRecipientIds(
  db: GardenDb,
  issue: typeof schema.issue.$inferSelect,
  args: { agentId?: string | null; excludeIds?: string[] } = {},
): Promise<string[]> {
  const excludeIds = args.excludeIds ?? []
  if (issue.teamId) {
    const recipientId = await teamItemRecipientId(db, {
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      agentId: args.agentId ?? null,
      issue,
      excludeIds,
    })
    return recipientId ? [recipientId] : []
  }
  return issueRecipientIds(db, issue, excludeIds)
}

async function loadIssue(
  db: GardenDb,
  workspaceId: string,
  issueId: string,
): Promise<typeof schema.issue.$inferSelect | null> {
  const [issue] = await db
    .select()
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.workspaceId, workspaceId),
        eq(schema.issue.id, issueId),
      ),
    )
  return issue ?? null
}

function issueDetails(issue: typeof schema.issue.$inferSelect) {
  return {
    issue_number: String(issue.number),
    status: issue.status ?? 'todo',
  }
}

export async function upsertIssueAssignmentInbox(args: {
  db: GardenDb
  workspaceId: string
  issueId: string
  actorType?: InboxActorType
  actorId?: string | null
}): Promise<void> {
  const issue = await loadIssue(args.db, args.workspaceId, args.issueId)
  if (!issue || issue.assigneeType !== 'user' || !issue.assigneeId) return
  if (issue.status === 'done' || issue.status === 'cancelled') return
  if (args.actorId && issue.assigneeId === args.actorId) return

  await upsertInboxItem(args.db, {
    workspaceId: args.workspaceId,
    recipientId: issue.assigneeId,
    itemKey: `assigned:${issue.id}`,
    type: 'issue_assigned',
    severity: 'action_required',
    issueId: issue.id,
    issueStatus: issue.status,
    title: `You were assigned to ${issue.title}`,
    body: truncate(issue.description),
    actorType: args.actorType ?? null,
    actorId: args.actorId ?? null,
    details: {
      ...issueDetails(issue),
      priority: issue.priority ?? 'medium',
    },
    activityAt: preferDate(issue.updatedAt, issue.createdAt),
  })
}

export async function upsertAgentCommentInbox(args: {
  db: GardenDb
  workspaceId: string
  issueId: string
  commentId: string
  agentId: string
  body: string
  createdAt?: Date
}): Promise<void> {
  const issue = await loadIssue(args.db, args.workspaceId, args.issueId)
  if (!issue || issue.status === 'done' || issue.status === 'cancelled') return

  const recipients = await issueRecipientIds(args.db, issue)
  await Promise.all(
    recipients.map((recipientId) =>
      upsertInboxItem(args.db, {
        workspaceId: args.workspaceId,
        recipientId,
        itemKey: `comment:${args.commentId}`,
        type: 'new_comment',
        severity: 'attention',
        issueId: issue.id,
        issueStatus: issue.status,
        title: `New comment on ${issue.title}`,
        body: truncate(args.body),
        actorType: 'agent',
        actorId: args.agentId,
        details: {
          ...issueDetails(issue),
          comment_id: args.commentId,
        },
        activityAt: args.createdAt ?? new Date(),
      }),
    ),
  )
}

export async function upsertWaitingForInputInbox(args: {
  db: GardenDb
  workspaceId: string
  issueId: string
  runId: string
  agentId: string
  error?: string | null
  activityAt?: Date
}): Promise<void> {
  const issue = await loadIssue(args.db, args.workspaceId, args.issueId)
  if (!issue || issue.status === 'done' || issue.status === 'cancelled') return

  const recipients = await resolveIssueRecipientIds(args.db, issue, {
    agentId: args.agentId,
  })
  await Promise.all(
    recipients.map((recipientId) =>
      upsertInboxItem(args.db, {
        workspaceId: args.workspaceId,
        recipientId,
        itemKey: `waiting_for_input:${args.runId}`,
        type: 'waiting_for_input',
        severity: 'action_required',
        issueId: issue.id,
        issueStatus: issue.status,
        title: `Garden is waiting on you on ${issue.title}`,
        body: truncate(args.error),
        actorType: 'agent',
        actorId: args.agentId,
        details: {
          ...issueDetails(issue),
          kind: 'waiting_for_input',
          run_id: args.runId,
        },
        activityAt: args.activityAt ?? new Date(),
      }),
    ),
  )
}

export async function upsertWorkProductReviewInbox(args: {
  db: GardenDb
  workspaceId: string
  workProductId: string
}): Promise<void> {
  const [row] = await args.db
    .select({
      workProduct: schema.issueWorkProduct,
      issue: schema.issue,
    })
    .from(schema.issueWorkProduct)
    .innerJoin(
      schema.issue,
      eq(schema.issue.id, schema.issueWorkProduct.issueId),
    )
    .where(
      and(
        eq(schema.issueWorkProduct.workspaceId, args.workspaceId),
        eq(schema.issueWorkProduct.id, args.workProductId),
      ),
    )
  if (!row) return
  if (row.workProduct.reviewState !== 'pending') return
  if (row.issue.status === 'done' || row.issue.status === 'cancelled') return

  const title = row.workProduct.title?.trim() || `${row.workProduct.type} ready`
  const recipients = await resolveIssueRecipientIds(args.db, row.issue, {
    agentId: row.workProduct.agentId,
  })
  await Promise.all(
    recipients.map((recipientId) =>
      upsertInboxItem(args.db, {
        workspaceId: args.workspaceId,
        recipientId,
        itemKey: `wp_review:${row.workProduct.id}`,
        type: 'wp_review',
        severity: 'action_required',
        issueId: row.issue.id,
        issueStatus: row.issue.status,
        title: `${title} on ${row.issue.title}`,
        body: truncate(row.workProduct.body),
        actorType: 'agent',
        actorId: row.workProduct.agentId,
        details: {
          ...issueDetails(row.issue),
          kind: 'wp_review',
          work_product_id: row.workProduct.id,
          work_product_type: row.workProduct.type,
        },
        activityAt: preferDate(
          row.workProduct.updatedAt,
          row.workProduct.createdAt,
        ),
      }),
    ),
  )
}

/** Writes connector approval inbox items from the legacy permission ledger. */
export async function upsertPermissionRequestInbox(args: {
  db: GardenDb
  workspaceId: string
  requestId: string
}): Promise<void> {
  const [row] = await args.db
    .select({
      request: schema.permissionRequest,
      issue: schema.issue,
    })
    .from(schema.permissionRequest)
    .leftJoin(
      schema.issue,
      eq(schema.issue.id, schema.permissionRequest.issueId),
    )
    .innerJoin(
      schema.agent,
      eq(schema.agent.id, schema.permissionRequest.agentId),
    )
    .where(
      and(
        eq(schema.permissionRequest.id, args.requestId),
        eq(schema.permissionRequest.kind, 'connector_write'),
        eq(schema.agent.workspaceId, args.workspaceId),
      ),
    )
  if (!row || row.request.status !== 'pending') return
  if (
    row.issue &&
    (row.issue.status === 'done' || row.issue.status === 'cancelled')
  )
    return

  const recipients = row.issue?.teamId
    ? await resolveIssueRecipientIds(args.db, row.issue, {
        agentId: row.request.agentId,
      })
    : await workspacePermissionApproverIds(args.db, args.workspaceId)
  const titleSuffix = row.issue ? ` on ${row.issue.title}` : ''
  await Promise.all(
    recipients.map((recipientId) =>
      upsertInboxItem(args.db, {
        workspaceId: args.workspaceId,
        recipientId,
        itemKey: `approval:${row.request.id}`,
        type: 'review_requested',
        severity: 'action_required',
        issueId: row.request.issueId,
        issueStatus: row.issue?.status ?? null,
        title: `Approval needed${titleSuffix}`,
        body: truncate(row.request.context),
        actorType: 'agent',
        actorId: row.request.agentId,
        details: {
          kind: 'approval',
          request_id: row.request.id,
          ...(row.issue ? issueDetails(row.issue) : {}),
        },
        activityAt: preferDate(row.request.requestedAt),
      }),
    ),
  )
}

function agentProposalBody(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as { name?: unknown; role?: unknown }
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const role = typeof payload.role === 'string' ? payload.role.trim() : ''
  if (name && role) return `${name} — ${role}`
  return name || role || null
}

/**
 * Writes approval inbox items from Garden's dedicated proposal ledger. Unlike
 * connector approvals, proposals identify the pending agent directly and show
 * proposal details instead of encoded permission context.
 */
export async function upsertAgentProposalRequestInbox(args: {
  db: GardenDb
  workspaceId: string
  requestId: string
}): Promise<void> {
  const [row] = await args.db
    .select({
      request: schema.agentProposalRequest,
      issue: schema.issue,
    })
    .from(schema.agentProposalRequest)
    .leftJoin(
      schema.issue,
      eq(schema.issue.id, schema.agentProposalRequest.issueId),
    )
    .innerJoin(
      schema.agent,
      eq(schema.agent.id, schema.agentProposalRequest.agentId),
    )
    .where(
      and(
        eq(schema.agentProposalRequest.id, args.requestId),
        eq(schema.agent.workspaceId, args.workspaceId),
      ),
    )
  if (!row || row.request.status !== 'pending') return
  if (
    row.issue &&
    (row.issue.status === 'done' || row.issue.status === 'cancelled')
  )
    return

  const recipients = row.issue?.teamId
    ? await resolveIssueRecipientIds(args.db, row.issue, {
        agentId: row.request.agentId,
      })
    : await workspacePermissionApproverIds(args.db, args.workspaceId)
  const titleSuffix = row.issue ? ` on ${row.issue.title}` : ''
  await Promise.all(
    recipients.map((recipientId) =>
      upsertInboxItem(args.db, {
        workspaceId: args.workspaceId,
        recipientId,
        itemKey: `approval:${row.request.id}`,
        type: 'review_requested',
        severity: 'action_required',
        issueId: row.request.issueId,
        issueStatus: row.issue?.status ?? null,
        title: `Agent proposal needs approval${titleSuffix}`,
        body: truncate(agentProposalBody(row.request.argsJson)),
        actorType: 'agent',
        actorId: row.request.agentId,
        details: {
          kind: 'agent_proposal',
          request_id: row.request.id,
          pending_agent_id: row.request.pendingAgentId,
          ...(row.issue ? issueDetails(row.issue) : {}),
        },
        activityAt: preferDate(row.request.requestedAt),
      }),
    ),
  )
}

export async function archiveInboxItemsByKey(args: {
  db: GardenDb
  workspaceId: string
  itemKeys: string[]
}): Promise<void> {
  if (args.itemKeys.length === 0) return
  await args.db
    .update(schema.inboxItem)
    .set({ read: true, archived: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        inArray(schema.inboxItem.itemKey, args.itemKeys),
      ),
    )
}

export async function archiveTerminalIssueInbox(args: {
  db: GardenDb
  workspaceId: string
  issueId: string
}): Promise<void> {
  await args.db
    .update(schema.inboxItem)
    .set({ read: true, archived: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inboxItem.workspaceId, args.workspaceId),
        eq(schema.inboxItem.issueId, args.issueId),
      ),
    )
}
