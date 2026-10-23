import { and, eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { schema, type Db } from '@/lib/server/db'
import type {
  GitHubWebhookBindingMatch,
  GitHubWebhookIssueTarget,
} from './github-webhook-resolve'

export class GitHubWebhookApplyError extends TaggedError(
  'GitHubWebhookApplyError',
)<{
  code: 'issue_not_found' | 'unsupported_action' | 'db_error'
  message: string
  cause?: unknown
}>() {}

export type GitHubWebhookApplyField = 'title' | 'description' | 'status'

export type GitHubWebhookApplyResult = {
  applied: boolean
  skippedReason: 'bot_sender' | 'unsupported_action' | 'noop' | null
  fields: GitHubWebhookApplyField[]
}

/**
 * Maps GitHub issue webhook actions onto Garden issue columns (#161).
 * - edited → title + description
 * - closed → status done
 * - reopened → status todo
 * Bot senders are skipped to avoid Garden→GitHub→Garden echo loops.
 */
export function planGitHubWebhookIssueApply(
  target: GitHubWebhookIssueTarget,
): {
  fields: Partial<{
    title: string
    description: string | null
    status: 'todo' | 'done'
  }>
  planned: GitHubWebhookApplyField[]
} | null {
  if (target.action === 'edited') {
    const fields: Partial<{
      title: string
      description: string | null
      status: 'todo' | 'done'
    }> = {}
    const planned: GitHubWebhookApplyField[] = []
    if (target.title !== null) {
      fields.title = target.title
      planned.push('title')
    }
    // GitHub may send body: null when cleared; still sync that.
    fields.description = target.body
    planned.push('description')
    return planned.length > 0 ? { fields, planned } : null
  }

  if (target.action === 'closed') {
    return { fields: { status: 'done' }, planned: ['status'] }
  }

  if (target.action === 'reopened') {
    return { fields: { status: 'todo' }, planned: ['status'] }
  }

  return null
}

/**
 * Applies a planned inbound GitHub issue change to the linked Garden issue and
 * bumps the binding's last_synced_at.
 */
export async function applyGitHubWebhookIssueUpdate(args: {
  db: Db
  binding: GitHubWebhookBindingMatch
  target: GitHubWebhookIssueTarget
}): Promise<Result<GitHubWebhookApplyResult, GitHubWebhookApplyError>> {
  if (args.target.senderType === 'Bot') {
    return Result.ok({
      applied: false,
      skippedReason: 'bot_sender',
      fields: [],
    })
  }

  const plan = planGitHubWebhookIssueApply(args.target)
  if (!plan) {
    return Result.ok({
      applied: false,
      skippedReason: 'unsupported_action',
      fields: [],
    })
  }

  const [existing] = await args.db
    .select({
      id: schema.issue.id,
      title: schema.issue.title,
      description: schema.issue.description,
      status: schema.issue.status,
    })
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.id, args.binding.issueId),
        eq(schema.issue.workspaceId, args.binding.workspaceId),
      ),
    )
    .limit(1)

  if (!existing) {
    return Result.err(
      new GitHubWebhookApplyError({
        code: 'issue_not_found',
        message: 'Linked Garden issue was not found for this binding',
      }),
    )
  }

  const changedFields: GitHubWebhookApplyField[] = []
  const patch: {
    title?: string
    description?: string | null
    status?: string
    updatedAt: Date
  } = { updatedAt: new Date() }

  if (
    plan.fields.title !== undefined &&
    plan.fields.title !== existing.title
  ) {
    patch.title = plan.fields.title
    changedFields.push('title')
  }
  if (
    plan.fields.description !== undefined &&
    plan.fields.description !== (existing.description ?? null)
  ) {
    patch.description = plan.fields.description
    changedFields.push('description')
  }
  if (
    plan.fields.status !== undefined &&
    plan.fields.status !== (existing.status ?? 'todo')
  ) {
    patch.status = plan.fields.status
    changedFields.push('status')
  }

  if (changedFields.length === 0) {
    await args.db
      .update(schema.issueSourceBinding)
      .set({ lastSyncedAt: new Date() })
      .where(eq(schema.issueSourceBinding.id, args.binding.bindingId))

    return Result.ok({
      applied: false,
      skippedReason: 'noop',
      fields: [],
    })
  }

  const writeResult = await Result.tryPromise({
    try: async () => {
      await args.db.transaction(async (tx) => {
        await tx
          .update(schema.issue)
          .set(patch)
          .where(
            and(
              eq(schema.issue.id, args.binding.issueId),
              eq(schema.issue.workspaceId, args.binding.workspaceId),
            ),
          )
        await tx
          .update(schema.issueSourceBinding)
          .set({ lastSyncedAt: new Date() })
          .where(eq(schema.issueSourceBinding.id, args.binding.bindingId))
      })
    },
    catch: (cause) =>
      new GitHubWebhookApplyError({
        code: 'db_error',
        message: 'Failed to apply GitHub webhook issue update',
        cause,
      }),
  })
  if (writeResult.isErr()) return writeResult

  return Result.ok({
    applied: true,
    skippedReason: null,
    fields: changedFields,
  })
}
