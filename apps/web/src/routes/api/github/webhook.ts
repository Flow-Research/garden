import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  serviceUnavailable,
  unauthorized,
} from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { verifyGitHubWebhookSignature } from '@/lib/server/github-webhook'
import {
  applyGitHubWebhookComment,
  applyGitHubWebhookIssueUpdate,
} from '@/lib/server/github-webhook-apply'
import {
  claimGitHubWebhookDelivery,
  githubWebhookCommentOrderScope,
  githubWebhookIssueOrderScope,
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
 * Verify signature → claim delivery (dedupe/order) → parse issues.* or
 * issue_comment.* → resolve install/binding → apply → lifecycle + realtime.
 * Unmatched or skipped deliveries still return 200 so GitHub stops retrying.
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

        const deliveryId = request.headers.get('x-github-delivery')
        const githubEvent = request.headers.get('x-github-event') ?? 'unknown'

        const text = new TextDecoder().decode(rawBody)
        let payload: unknown
        try {
          payload = JSON.parse(text) as unknown
        } catch {
          return badRequest('Webhook body must be valid JSON')
        }

        const commentTargetResult = parseGitHubWebhookCommentTarget(payload)
        if (commentTargetResult.isErr()) {
          return badRequest(commentTargetResult.error.message)
        }

        if (commentTargetResult.value !== null) {
          const target = commentTargetResult.value
          const db = await appContext.db()
          const bindingResult = await resolveGitHubWebhookBinding({
            db,
            target,
          })
          const binding = bindingResult.match({
            ok: (value) => value,
            err: () => null,
          })
          if (!binding) {
            return json({ ok: true, status: 'unbound' }, 200)
          }

          const claim = await claimGitHubWebhookDelivery({
            db,
            deliveryId,
            event: githubEvent,
            action: target.action,
            installationId: target.installationId,
            orderScope: githubWebhookCommentOrderScope(
              binding.bindingId,
              target.commentId,
            ),
            orderMarker: target.updatedAtMs,
            bindingId: binding.bindingId,
            workspaceId: binding.workspaceId,
          })
          if (claim.isErr()) {
            if (claim.error.code === 'missing_delivery_id') {
              return badRequest(claim.error.message)
            }
            return serviceUnavailable(claim.error.message)
          }
          if (claim.value.kind === 'duplicate') {
            return json({ ok: true, status: 'duplicate' }, 200)
          }
          if (claim.value.kind === 'out_of_order') {
            return json({ ok: true, status: 'out_of_order' }, 200)
          }

          const applyResult = await applyGitHubWebhookComment({
            db,
            binding,
            target,
          })
          if (applyResult.isErr()) {
            if (applyResult.error.code === 'issue_not_found') {
              return json({ ok: true, status: 'unbound' }, 200)
            }
            return serviceUnavailable(applyResult.error.message)
          }

          if (
            applyResult.value.applied &&
            applyResult.value.action &&
            applyResult.value.commentId
          ) {
            const [issue] = await db
              .select({
                teamId: schema.issue.teamId,
                assigneeId: schema.issue.assigneeId,
              })
              .from(schema.issue)
              .where(eq(schema.issue.id, binding.issueId))
              .limit(1)
            publishCommentChangedEvent({
              env: appEnv,
              waitUntil: (promise) => appContext.waitUntil(promise),
              workspaceId: binding.workspaceId,
              action: applyResult.value.action,
              issueId: binding.issueId,
              commentId: applyResult.value.commentId,
              teamId: issue?.teamId ?? null,
              assigneeId: issue?.assigneeId ?? null,
            })
          }

          return json(
            {
              ok: true,
              status: applyResult.value.applied ? 'applied' : 'skipped',
              skipped_reason: applyResult.value.skippedReason,
              comment_action: applyResult.value.action,
              workspace_id: binding.workspaceId,
              issue_id: binding.issueId,
              binding_id: binding.bindingId,
            },
            200,
          )
        }

        const targetResult = parseGitHubWebhookIssueTarget(payload)
        if (targetResult.isErr()) {
          return badRequest(targetResult.error.message)
        }
        if (targetResult.value === null) {
          return json({ ok: true, status: 'ignored' }, 200)
        }

        const target = targetResult.value
        const db = await appContext.db()
        const bindingResult = await resolveGitHubWebhookBinding({
          db,
          target,
        })
        const binding = bindingResult.match({
          ok: (value) => value,
          err: () => null,
        })
        if (!binding) {
          return json({ ok: true, status: 'unbound' }, 200)
        }

        const claim = await claimGitHubWebhookDelivery({
          db,
          deliveryId,
          event: githubEvent,
          action: target.action,
          installationId: target.installationId,
          orderScope: githubWebhookIssueOrderScope(binding.bindingId),
          orderMarker: target.updatedAtMs,
          bindingId: binding.bindingId,
          workspaceId: binding.workspaceId,
        })
        if (claim.isErr()) {
          if (claim.error.code === 'missing_delivery_id') {
            return badRequest(claim.error.message)
          }
          return serviceUnavailable(claim.error.message)
        }
        if (claim.value.kind === 'duplicate') {
          return json({ ok: true, status: 'duplicate' }, 200)
        }
        if (claim.value.kind === 'out_of_order') {
          return json({ ok: true, status: 'out_of_order' }, 200)
        }

        const applyResult = await applyGitHubWebhookIssueUpdate({
          db,
          binding,
          target,
        })
        if (applyResult.isErr()) {
          if (applyResult.error.code === 'issue_not_found') {
            return json({ ok: true, status: 'unbound' }, 200)
          }
          return serviceUnavailable(applyResult.error.message)
        }

        if (applyResult.value.applied) {
          const [nextIssue] = await db
            .select()
            .from(schema.issue)
            .where(eq(schema.issue.id, binding.issueId))
            .limit(1)
          if (nextIssue) {
            await applyIssueMutationSideEffects({
              db,
              env: appEnv,
              waitUntil: (promise) => appContext.waitUntil(promise),
              workspaceId: binding.workspaceId,
              previous: {
                status: applyResult.value.previousStatus,
                assigneeType: applyResult.value.previousAssigneeType,
                assigneeId: applyResult.value.previousAssigneeId,
              },
              nextIssue,
              actor: { type: 'system', id: 'github-webhook' },
              wakeOnAssignment: false,
            })
          }
        }

        return json(
          {
            ok: true,
            status: applyResult.value.applied ? 'applied' : 'skipped',
            skipped_reason: applyResult.value.skippedReason,
            fields: applyResult.value.fields,
            workspace_id: binding.workspaceId,
            issue_id: binding.issueId,
            binding_id: binding.bindingId,
          },
          200,
        )
      },
    },
  },
})
