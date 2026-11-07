import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  serviceUnavailable,
  unauthorized,
} from '@/lib/server/control-plane'
import type { Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { resolveGitHubAppSlug } from '@/lib/server/github-app'
import { verifyGitHubWebhookSignature } from '@/lib/server/github-webhook'
import {
  ensureLinkedGitHubIssue,
  githubWebhookIssueCandidate,
} from '@/lib/server/github-issue-sync'
import { publishCreatedIssues } from '@/lib/server/github-repo-import'
import {
  GITHUB_ISSUE_CREATING_ACTIONS,
  applyGitHubWebhookComment,
  applyGitHubWebhookIssueUpdate,
  isSupportedGitHubCommentAction,
  planGitHubWebhookIssueApply,
  type IssuePatch,
} from '@/lib/server/github-webhook-apply'
import {
  githubWebhookCommentOrderScope,
  githubWebhookIssueOrderScope,
  processGitHubWebhookDelivery,
  type GitHubWebhookDelivery,
  GitHubWebhookDeliveryError,
} from '@/lib/server/github-webhook-delivery'
import {
  parseGitHubWebhookCommentTarget,
  parseGitHubWebhookIssueTarget,
  resolveGitHubWebhookBindings,
  type GitHubWebhookBindingMatch,
  type GitHubWebhookCommentTarget,
  type GitHubWebhookIssueTarget,
} from '@/lib/server/github-webhook-resolve'
import {
  applyIssueMutationSideEffects,
  publishCommentChangedEvent,
} from '@/lib/server/issue-mutation-effects'

const logger = createGardenLogger({
  service: 'garden',
  component: 'github-webhook',
})

type DeliveryContext = {
  db: Db
  waitUntil: (promise: Promise<unknown>) => void
  delivery: GitHubWebhookDelivery
  appSlug: string
}

type BindingResult = Result<Record<string, unknown>, GitHubWebhookDeliveryError>

/** Records and applies one `issue_comment` delivery for one linked issue. */
async function deliverComment(
  ctx: DeliveryContext,
  binding: GitHubWebhookBindingMatch,
  target: GitHubWebhookCommentTarget,
): Promise<BindingResult> {
  const processed = await processGitHubWebhookDelivery({
    db: ctx.db,
    bindingId: binding.bindingId,
    delivery: ctx.delivery,
    order: {
      scope: githubWebhookCommentOrderScope(
        binding.bindingId,
        target.commentId,
      ),
      marker: target.updatedAtMs,
    },
    apply: (tx) =>
      applyGitHubWebhookComment({
        tx,
        binding,
        target,
        appSlug: ctx.appSlug,
      }),
  })
  return processed.map((outcome) => {
    if (outcome.kind !== 'processed') return { status: outcome.kind }
    const applied = outcome.result
    if (applied.kind === 'skipped') {
      return { status: 'skipped', skipped_reason: applied.reason }
    }
    publishCommentChangedEvent({
      env: appEnv,
      waitUntil: ctx.waitUntil,
      workspaceId: binding.workspaceId,
      action: applied.action,
      issueId: binding.issueId,
      commentId: applied.commentId,
      teamId: applied.issue.teamId,
      assigneeId: applied.issue.assigneeId,
    })
    return {
      status: 'applied',
      comment_action: applied.action,
      comment_id: applied.commentId,
      issue_id: binding.issueId,
    }
  })
}

/**
 * Records and applies one `issues` delivery for one linked issue, then runs
 * the issue lifecycle effects after commit.
 *
 * Why effects failures are logged, not thrown: the earlier version awaited
 * them bare, so a throw after commit made the route 500. GitHub's redelivery
 * then hit the ledger as `duplicate`, and the effects never ran. The write has
 * committed by this point, so the delivery is acknowledged and the failure is
 * logged for an operator.
 */
async function deliverIssue(
  ctx: DeliveryContext,
  binding: GitHubWebhookBindingMatch,
  target: GitHubWebhookIssueTarget,
  plan: IssuePatch,
): Promise<BindingResult> {
  const processed = await processGitHubWebhookDelivery({
    db: ctx.db,
    bindingId: binding.bindingId,
    delivery: ctx.delivery,
    order: {
      scope: githubWebhookIssueOrderScope(binding.bindingId),
      marker: target.updatedAtMs,
    },
    apply: (tx) =>
      applyGitHubWebhookIssueUpdate({
        tx,
        binding,
        target,
        plan,
        appSlug: ctx.appSlug,
      }),
  })
  if (processed.isErr()) return Result.err(processed.error)
  const outcome = processed.value
  if (outcome.kind !== 'processed') return Result.ok({ status: outcome.kind })
  const applied = outcome.result
  if (applied.kind === 'skipped') {
    return Result.ok({ status: 'skipped', skipped_reason: applied.reason })
  }

  const effects = await Result.tryPromise(() =>
    applyIssueMutationSideEffects({
      db: ctx.db,
      env: appEnv,
      waitUntil: ctx.waitUntil,
      workspaceId: binding.workspaceId,
      previous: applied.previous,
      nextIssue: applied.issue,
      actor: { type: 'system', id: 'github-webhook' },
    }),
  )
  if (effects.isErr()) {
    logger.error('github_webhook.issue_effects_failed', {
      ...errorFields(effects.error.cause),
      deliveryId: ctx.delivery.deliveryId,
      issueId: binding.issueId,
    })
  }
  return Result.ok({
    status: 'applied',
    fields: applied.fields,
    issue_id: binding.issueId,
  })
}

/**
 * Creates the Garden issue for a delivery on a linked repository before the
 * per-binding apply runs, so the apply and the ledger see the new binding.
 * Created issues are published only after their transaction commits.
 *
 * Why Garden's own App bot is not skipped here: the earlier version skipped
 * it as the apply step does, so an issue an agent opened through the App
 * never reached the Team board. Echo suppression exists so Garden's writes to
 * an issue it already holds do not come back as updates. A create has nothing
 * to echo, so only the apply step keeps that skip.
 */
async function ensureLinkedIssue(
  ctx: Omit<DeliveryContext, 'delivery'>,
  target: GitHubWebhookIssueTarget,
  payload: unknown,
): Promise<Result<void, GitHubWebhookDeliveryError>> {
  if (!GITHUB_ISSUE_CREATING_ACTIONS.has(target.action)) return Result.ok()
  const candidate = githubWebhookIssueCandidate(payload, target.action)
  if (!candidate) return Result.ok()
  const ensured = await Result.tryPromise({
    try: () =>
      ensureLinkedGitHubIssue({
        db: ctx.db,
        installationId: target.installationId,
        candidate,
      }),
    catch: (cause) =>
      new GitHubWebhookDeliveryError({
        message: 'Failed to create the Garden issue for a linked repository',
        cause,
      }),
  })
  if (ensured.isErr()) return Result.err(ensured.error)
  for (const { workspaceId, issue } of ensured.value.created) {
    await publishCreatedIssues({
      db: ctx.db,
      env: appEnv,
      waitUntil: ctx.waitUntil,
      workspaceId,
      issues: [issue],
    })
  }
  return Result.ok()
}

/**
 * Runs one delivery against each linked issue in turn. Any ledger failure
 * answers 503 so a redelivery retries; links that already committed see the
 * redelivery as `duplicate`.
 */
async function deliverToBindings(
  bindings: GitHubWebhookBindingMatch[],
  run: (binding: GitHubWebhookBindingMatch) => Promise<BindingResult>,
) {
  if (bindings.length === 0) return json({ ok: true, status: 'unbound' }, 200)
  const results: Record<string, unknown>[] = []
  for (const binding of bindings) {
    const result = await run(binding)
    if (result.isErr()) return serviceUnavailable(result.error.message)
    results.push(result.value)
  }
  return json({ ok: true, results }, 200)
}

/**
 * GitHub App webhook ingress (#161).
 *
 * Verify signature, parse `issues.*` or `issue_comment.*`, drop actions Garden
 * does not apply, create the Garden issue when the repository is linked to a
 * Team, resolve every linked issue for the installation, then record
 * and apply the delivery per link in one transaction each
 * (`processGitHubWebhookDelivery`). Lifecycle effects and realtime events run
 * only after that transaction commits. Unbound, unsupported, duplicate, stale,
 * and skipped deliveries return 200 so GitHub does not mark them failed.
 */
export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const rawBody = await request.arrayBuffer()
        const verified = await verifyGitHubWebhookSignature({
          secret: appEnv.GITHUB_WEBHOOK_SECRET,
          rawBody,
          signatureHeader: request.headers.get('x-hub-signature-256'),
        })
        if (verified.isErr()) {
          switch (verified.error.code) {
            case 'missing_secret':
              return serviceUnavailable(verified.error.message)
            case 'missing_signature':
              return badRequest(verified.error.message)
            case 'invalid_signature':
              return unauthorized()
          }
        }

        const deliveryId = request.headers.get('x-github-delivery')?.trim()
        if (!deliveryId) {
          return badRequest('Missing X-GitHub-Delivery header')
        }
        const event = request.headers.get('x-github-event') ?? 'unknown'

        const payload = Result.try(
          () => JSON.parse(new TextDecoder().decode(rawBody)) as unknown,
        )
        if (payload.isErr()) {
          return badRequest('Webhook body must be valid JSON')
        }

        const ctx = {
          db: await appContext.db(),
          waitUntil: (promise: Promise<unknown>) =>
            appContext.waitUntil(promise),
          appSlug: resolveGitHubAppSlug(appEnv),
        }

        const commentTarget = parseGitHubWebhookCommentTarget(payload.value)
        if (commentTarget.isErr()) {
          return badRequest(commentTarget.error.message)
        }
        if (commentTarget.value !== null) {
          const target = commentTarget.value
          if (!isSupportedGitHubCommentAction(target.action)) {
            return json({ ok: true, status: 'unsupported_action' }, 200)
          }
          const delivery = { deliveryId, event, action: target.action }
          return deliverToBindings(
            await resolveGitHubWebhookBindings({ db: ctx.db, target }),
            (binding) => deliverComment({ ...ctx, delivery }, binding, target),
          )
        }

        const issueTarget = parseGitHubWebhookIssueTarget(payload.value)
        if (issueTarget.isErr()) {
          return badRequest(issueTarget.error.message)
        }
        if (issueTarget.value === null) {
          return json({ ok: true, status: 'ignored' }, 200)
        }
        const target = issueTarget.value
        const plan = planGitHubWebhookIssueApply(target)
        if (!plan) return json({ ok: true, status: 'unsupported_action' }, 200)
        const ensured = await ensureLinkedIssue(ctx, target, payload.value)
        if (ensured.isErr()) return serviceUnavailable(ensured.error.message)
        const delivery = { deliveryId, event, action: target.action }
        return deliverToBindings(
          await resolveGitHubWebhookBindings({ db: ctx.db, target }),
          (binding) =>
            deliverIssue({ ...ctx, delivery }, binding, target, plan),
        )
      },
    },
  },
})
