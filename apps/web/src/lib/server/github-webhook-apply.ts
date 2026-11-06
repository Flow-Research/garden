import { and, eq } from 'drizzle-orm'
import { schema } from '@/lib/server/db'
import type { GitHubWebhookTx } from './github-webhook-delivery'
import type { IssueLifecycleSnapshot } from './issue-mutation-effects'
import type {
  GitHubWebhookBindingMatch,
  GitHubWebhookCommentTarget,
  GitHubWebhookIssueTarget,
} from './github-webhook-resolve'

export type GitHubWebhookApplyField = 'title' | 'description' | 'status'

export type GitHubWebhookSkipReason =
  | 'bot_sender'
  | 'unsupported_action'
  | 'noop'
  | 'unbound'

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

type IssuePatch = Partial<{
  title: string
  description: string | null
  status: 'todo' | 'done'
}>

/**
 * Maps GitHub issue webhook actions onto Garden issue columns (#161).
 * `edited` syncs title and body, `closed` sets done, `reopened` sets todo.
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
      return { status: 'done' }
    case 'reopened':
      return { status: 'todo' }
    default:
      return null
  }
}

function touchBinding(tx: GitHubWebhookTx, bindingId: string) {
  return tx
    .update(schema.issueSourceBinding)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.issueSourceBinding.id, bindingId))
}

/**
 * Writes an inbound GitHub issue change to the linked Garden issue inside the
 * delivery transaction. Bot senders are skipped so Garden's own GitHub writes
 * do not echo back. Lifecycle effects (inbox archive, run cancel, realtime)
 * run after commit in the route, through `applyIssueMutationSideEffects`, the
 * same helper `PUT /api/issues/$id` uses.
 */
export async function applyGitHubWebhookIssueUpdate(args: {
  tx: GitHubWebhookTx
  binding: GitHubWebhookBindingMatch
  target: GitHubWebhookIssueTarget
}): Promise<GitHubWebhookIssueApplyOutcome> {
  if (args.target.senderType === 'Bot') {
    return { kind: 'skipped', reason: 'bot_sender' }
  }
  const plan = planGitHubWebhookIssueApply(args.target)
  if (!plan) return { kind: 'skipped', reason: 'unsupported_action' }

  const issueMatch = and(
    eq(schema.issue.id, args.binding.issueId),
    eq(schema.issue.workspaceId, args.binding.workspaceId),
  )
  const [existing] = await args.tx.select().from(schema.issue).where(issueMatch)
  if (!existing) return { kind: 'skipped', reason: 'unbound' }

  const patch: IssuePatch = {}
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

  await touchBinding(args.tx, args.binding.bindingId)
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
 * Bot senders are skipped so Garden's own GitHub comments do not echo back.
 */
export async function applyGitHubWebhookComment(args: {
  tx: GitHubWebhookTx
  binding: GitHubWebhookBindingMatch
  target: GitHubWebhookCommentTarget
}): Promise<GitHubWebhookCommentApplyOutcome> {
  if (args.target.senderType === 'Bot') {
    return { kind: 'skipped', reason: 'bot_sender' }
  }
  const action = args.target.action
  if (action !== 'created' && action !== 'edited' && action !== 'deleted') {
    return { kind: 'skipped', reason: 'unsupported_action' }
  }

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
