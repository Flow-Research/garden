import { and, eq, sql } from 'drizzle-orm'
import { schema } from '@/lib/server/db'
import type { GitHubWebhookTx } from './github-webhook-delivery'
import {
  firstMatchedAssignee,
  githubAssigneeMetadata,
  githubIssueStatus,
  matchGitHubMembers,
  type GitHubUserRef,
} from './github-issue-sync'
import type { IssueLifecycleSnapshot } from './issue-mutation-effects'
import type {
  GitHubWebhookBindingMatch,
  GitHubWebhookCommentTarget,
  GitHubWebhookIssueTarget,
} from './github-webhook-resolve'

export type GitHubWebhookApplyField =
  | 'title'
  | 'description'
  | 'status'
  | 'labels'
  | 'assignee'

export type GitHubWebhookSkipReason = 'own_app_sender' | 'noop' | 'unbound'

export type GitHubWebhookIssueApplyOutcome =
  | { kind: 'skipped'; reason: GitHubWebhookSkipReason }
  | {
      kind: 'applied'
      fields: GitHubWebhookApplyField[]
      previous: IssueLifecycleSnapshot
      issue: typeof schema.issue.$inferSelect
    }

export type GitHubWebhookCommentApplyOutcome =
  | { kind: 'skipped'; reason: GitHubWebhookSkipReason }
  | {
      kind: 'applied'
      action: 'created' | 'updated' | 'deleted'
      commentId: string
      issue: { teamId: string | null; assigneeId: string | null }
    }

export type IssuePatch = Partial<{
  title: string
  description: string | null
  status: 'todo' | 'done' | 'cancelled'
  labels: string[]
  /** GitHub's assignees after the change; matched to members at apply time. */
  assignees: GitHubUserRef[]
}>

/**
 * GitHub `issues` actions that can create the Garden issue for a linked
 * repository before the delivery applies. `edited`, `closed`, and `reopened`
 * only update issues that already exist.
 */
export const GITHUB_ISSUE_CREATING_ACTIONS: ReadonlySet<string> = new Set([
  'opened',
  'transferred',
  'assigned',
  'unassigned',
  'labeled',
  'unlabeled',
])

/**
 * Maps GitHub issue webhook actions onto Garden issue columns.
 *
 * `edited` syncs title and body. `closed` sets `done`, or `cancelled` when
 * GitHub closed it as not planned. `reopened` sets `todo`. Labels and
 * assignees sync from the issue's current lists. `opened` and `transferred`
 * patch nothing: the linked-repository create step already wrote the issue
 * from the same payload, and the ledger still records the delivery. No action
 * changes the status of an open issue, so Garden-side progress such as
 * `in_progress` survives GitHub edits.
 */
export function planGitHubWebhookIssueApply(
  target: GitHubWebhookIssueTarget,
): IssuePatch | null {
  switch (target.action) {
    case 'edited':
      return target.title === null
        ? { description: target.body }
        : { title: target.title, description: target.body }
    case 'closed':
      return {
        status: githubIssueStatus({
          state: 'closed',
          stateReason: target.stateReason,
        }),
      }
    case 'reopened':
      return { status: 'todo' }
    case 'opened':
    case 'transferred':
      return {}
    case 'assigned':
    case 'unassigned':
      return { assignees: target.assignees }
    case 'labeled':
    case 'unlabeled':
      return { labels: target.labels }
    default:
      return null
  }
}

/**
 * The Garden assignee after a GitHub assignment change. Human assignment
 * follows GitHub: the first GitHub assignee with a Garden member wins, and no
 * matched assignee clears a human assignee. GitHub cannot express an agent
 * assignee, so an agent assignment made in Garden stays.
 */
export function nextGitHubAssignee(args: {
  current: { assigneeType: string | null; assigneeId: string | null }
  matchedUserId: string | null
}): { assigneeType: 'user' | 'agent' | null; assigneeId: string | null } {
  if (args.matchedUserId) {
    return { assigneeType: 'user', assigneeId: args.matchedUserId }
  }
  if (args.current.assigneeType === 'agent') {
    return { assigneeType: 'agent', assigneeId: args.current.assigneeId }
  }
  return { assigneeType: null, assigneeId: null }
}

/**
 * Whether a delivery comes from Garden's own GitHub App bot, whose login is
 * `<app slug>[bot]`.
 *
 * Why the login and not `sender.type === 'Bot'`: the earlier check dropped
 * every bot, so issues closed by actions/stale, Dependabot, or an Actions
 * workflow never reached Garden while the ledger still said `applied`. Only
 * Garden's own writes echo back, so only Garden's bot is skipped.
 */
export function isOwnGitHubAppSender(
  senderLogin: string | null,
  appSlug: string,
) {
  return senderLogin === `${appSlug}[bot]`
}

/** GitHub `issue_comment` actions the comment apply step writes. */
export function isSupportedGitHubCommentAction(action: string) {
  return action === 'created' || action === 'edited' || action === 'deleted'
}

function touchBinding(
  tx: GitHubWebhookTx,
  bindingId: string,
  metadata?: Record<string, unknown>,
) {
  return tx
    .update(schema.issueSourceBinding)
    .set({
      lastSyncedAt: new Date(),
      ...(metadata
        ? {
            metadata: sql`coalesce(${schema.issueSourceBinding.metadata}, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb`,
          }
        : {}),
    })
    .where(eq(schema.issueSourceBinding.id, bindingId))
}

/**
 * Writes an inbound GitHub issue change to the linked Garden issue inside the
 * delivery transaction. Garden's own App bot is skipped so its GitHub writes
 * do not echo back. The route filters unsupported actions before the ledger,
 * so `plan` is non-null here. Lifecycle effects (inbox archive, run cancel, realtime)
 * run after commit in the route, through `applyIssueMutationSideEffects`, the
 * same helper `PUT /api/issues/$id` uses.
 */
export async function applyGitHubWebhookIssueUpdate(args: {
  tx: GitHubWebhookTx
  binding: GitHubWebhookBindingMatch
  target: GitHubWebhookIssueTarget
  plan: IssuePatch
  appSlug: string
}): Promise<GitHubWebhookIssueApplyOutcome> {
  if (isOwnGitHubAppSender(args.target.senderLogin, args.appSlug)) {
    return { kind: 'skipped', reason: 'own_app_sender' }
  }
  const plan = args.plan

  const issueMatch = and(
    eq(schema.issue.id, args.binding.issueId),
    eq(schema.issue.workspaceId, args.binding.workspaceId),
  )
  const [existing] = await args.tx.select().from(schema.issue).where(issueMatch)
  if (!existing) return { kind: 'skipped', reason: 'unbound' }

  const patch: Partial<typeof schema.issue.$inferInsert> = {}
  const fields: GitHubWebhookApplyField[] = []
  if (plan.title !== undefined && plan.title !== existing.title) {
    patch.title = plan.title
    fields.push('title')
  }
  if (
    plan.description !== undefined &&
    plan.description !== (existing.description ?? null)
  ) {
    patch.description = plan.description
    fields.push('description')
  }
  if (
    plan.status !== undefined &&
    plan.status !== (existing.status ?? 'todo')
  ) {
    patch.status = plan.status
    fields.push('status')
  }
  if (
    plan.labels !== undefined &&
    plan.labels.join('\u0000') !== existing.labels.join('\u0000')
  ) {
    patch.labels = plan.labels
    fields.push('labels')
  }
  if (plan.assignees !== undefined) {
    const members = await matchGitHubMembers(
      args.tx,
      args.binding.workspaceId,
      plan.assignees.map((assignee) => assignee.id),
    )
    const next = nextGitHubAssignee({
      current: existing,
      matchedUserId: firstMatchedAssignee(plan.assignees, members),
    })
    if (
      next.assigneeType !== existing.assigneeType ||
      next.assigneeId !== existing.assigneeId
    ) {
      patch.assigneeType = next.assigneeType
      patch.assigneeId = next.assigneeId
      fields.push('assignee')
    }
  }

  await touchBinding(
    args.tx,
    args.binding.bindingId,
    plan.assignees ? githubAssigneeMetadata(plan.assignees) : undefined,
  )
  if (fields.length === 0) return { kind: 'skipped', reason: 'noop' }

  const [issue] = await args.tx
    .update(schema.issue)
    .set({ ...patch, updatedAt: new Date() })
    .where(issueMatch)
    .returning()
  if (!issue) return { kind: 'skipped', reason: 'unbound' }

  return {
    kind: 'applied',
    fields,
    previous: {
      status: existing.status,
      assigneeType: existing.assigneeType,
      assigneeId: existing.assigneeId,
    },
    issue,
  }
}

/**
 * Creates, edits, or deletes a connector-sourced Garden comment from a GitHub
 * `issue_comment` webhook (#161), keyed on `(issue_id, external_comment_id)`.
 * Garden's own App bot is skipped so its GitHub comments do not echo back.
 * The route filters unsupported actions before the ledger.
 */
export async function applyGitHubWebhookComment(args: {
  tx: GitHubWebhookTx
  binding: GitHubWebhookBindingMatch
  target: GitHubWebhookCommentTarget
  appSlug: string
}): Promise<GitHubWebhookCommentApplyOutcome> {
  if (isOwnGitHubAppSender(args.target.senderLogin, args.appSlug)) {
    return { kind: 'skipped', reason: 'own_app_sender' }
  }
  const action = args.target.action

  const [issue] = await args.tx
    .select({
      teamId: schema.issue.teamId,
      assigneeId: schema.issue.assigneeId,
    })
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.id, args.binding.issueId),
        eq(schema.issue.workspaceId, args.binding.workspaceId),
      ),
    )
  if (!issue) return { kind: 'skipped', reason: 'unbound' }

  const [existing] = await args.tx
    .select({ id: schema.issueComment.id, body: schema.issueComment.body })
    .from(schema.issueComment)
    .where(
      and(
        eq(schema.issueComment.issueId, args.binding.issueId),
        eq(schema.issueComment.externalCommentId, args.target.commentId),
      ),
    )

  await touchBinding(args.tx, args.binding.bindingId)

  if (action === 'deleted') {
    if (!existing) return { kind: 'skipped', reason: 'noop' }
    await args.tx
      .delete(schema.issueComment)
      .where(eq(schema.issueComment.id, existing.id))
    return { kind: 'applied', action: 'deleted', commentId: existing.id, issue }
  }

  const metadata = {
    connector_id: 'github',
    github_login: args.target.githubLogin,
    github_user_id: args.target.githubUserId,
    html_url: args.target.commentHtmlUrl,
  }

  if (existing) {
    if (existing.body === args.target.body) {
      return { kind: 'skipped', reason: 'noop' }
    }
    await args.tx
      .update(schema.issueComment)
      .set({ body: args.target.body, metadata })
      .where(eq(schema.issueComment.id, existing.id))
    return { kind: 'applied', action: 'updated', commentId: existing.id, issue }
  }

  const commentId = crypto.randomUUID()
  await args.tx.insert(schema.issueComment).values({
    id: commentId,
    issueId: args.binding.issueId,
    authorType: 'connector',
    authorId: null,
    body: args.target.body,
    externalCommentId: args.target.commentId,
    metadata,
    ...(args.target.createdAt ? { createdAt: args.target.createdAt } : {}),
  })
  return { kind: 'applied', action: 'created', commentId, issue }
}
