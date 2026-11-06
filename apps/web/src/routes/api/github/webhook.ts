import { Result } from 'better-result'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  serviceUnavailable,
  unauthorized,
} from '@/lib/server/control-plane'
import { appEnv } from '@/lib/server/env'
import { verifyGitHubWebhookSignature } from '@/lib/server/github-webhook'
import {
  applyGitHubWebhookComment,
  applyGitHubWebhookIssueUpdate,
} from '@/lib/server/github-webhook-apply'
import {
  githubWebhookCommentOrderScope,
  githubWebhookIssueOrderScope,
  processGitHubWebhookDelivery,
} from '@/lib/server/github-webhook-delivery'
import {
  parseGitHubWebhookCommentTarget,
  parseGitHubWebhookIssueTarget,
  resolveGitHubWebhookBinding,
} from '@/lib/server/github-webhook-resolve'
import {
  applyIssueMutationSideEffects,
  publishCommentChangedEvent,
} from '@/lib/server/issue-mutation-effects'

/**
 * GitHub App webhook ingress (#161).
 *
 * Verify signature, parse `issues.*` or `issue_comment.*`, resolve the
 * installation and issue binding, then record and apply the delivery in one
 * transaction (`processGitHubWebhookDelivery`). Lifecycle effects and realtime
 * events run only after that transaction commits. Unbound, duplicate, stale,
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

        const commentTarget = parseGitHubWebhookCommentTarget(payload.value)
        if (commentTarget.isErr()) {
          return badRequest(commentTarget.error.message)
        }
        if (commentTarget.value !== null) {
          const target = commentTarget.value
          const db = await appContext.db()
          const binding = (
            await resolveGitHubWebhookBinding({ db, target })
          ).unwrap()
          if (!binding) return json({ ok: true, status: 'unbound' }, 200)

          const processed = await processGitHubWebhookDelivery({
            db,
            bindingId: binding.bindingId,
            delivery: { deliveryId, event, action: target.action },
            order: {
              scope: githubWebhookCommentOrderScope(
                binding.bindingId,
                target.commentId,
              ),
              marker: target.updatedAtMs,
            },
            apply: (tx) => applyGitHubWebhookComment({ tx, binding, target }),
          })
          if (processed.isErr()) {
            return serviceUnavailable(processed.error.message)
          }
          const outcome = processed.value
          if (outcome.kind !== 'processed') {
            return json({ ok: true, status: outcome.kind }, 200)
          }
          const applied = outcome.result
          if (applied.kind === 'skipped') {
            return json(
              { ok: true, status: 'skipped', skipped_reason: applied.reason },
              200,
            )
          }

          publishCommentChangedEvent({
            env: appEnv,
            waitUntil: (promise) => appContext.waitUntil(promise),
            workspaceId: binding.workspaceId,
            action: applied.action,
            issueId: binding.issueId,
            commentId: applied.commentId,
            teamId: applied.issue.teamId,
            assigneeId: applied.issue.assigneeId,
          })
          return json(
            {
              ok: true,
              status: 'applied',
              comment_action: applied.action,
              comment_id: applied.commentId,
              issue_id: binding.issueId,
            },
            200,
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
        const db = await appContext.db()
        const binding = (
          await resolveGitHubWebhookBinding({ db, target })
        ).unwrap()
        if (!binding) return json({ ok: true, status: 'unbound' }, 200)

        const processed = await processGitHubWebhookDelivery({
          db,
          bindingId: binding.bindingId,
          delivery: { deliveryId, event, action: target.action },
          order: {
            scope: githubWebhookIssueOrderScope(binding.bindingId),
            marker: target.updatedAtMs,
          },
          apply: (tx) => applyGitHubWebhookIssueUpdate({ tx, binding, target }),
        })
        if (processed.isErr()) {
          return serviceUnavailable(processed.error.message)
        }
        const outcome = processed.value
        if (outcome.kind !== 'processed') {
          return json({ ok: true, status: outcome.kind }, 200)
        }
        const applied = outcome.result
        if (applied.kind === 'skipped') {
          return json(
            { ok: true, status: 'skipped', skipped_reason: applied.reason },
            200,
          )
        }

        await applyIssueMutationSideEffects({
          db,
          env: appEnv,
          waitUntil: (promise) => appContext.waitUntil(promise),
          workspaceId: binding.workspaceId,
          previous: applied.previous,
          nextIssue: applied.issue,
          actor: { type: 'system', id: 'github-webhook' },
        })
        return json(
          {
            ok: true,
            status: 'applied',
            fields: applied.fields,
            issue_id: binding.issueId,
          },
          200,
        )
      },
    },
  },
})
