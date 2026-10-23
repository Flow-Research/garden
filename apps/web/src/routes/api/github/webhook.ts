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
import { applyGitHubWebhookIssueUpdate } from '@/lib/server/github-webhook-apply'
import {
  parseGitHubWebhookIssueTarget,
  resolveGitHubWebhookBinding,
} from '@/lib/server/github-webhook-resolve'

/**
 * GitHub App webhook ingress (#161).
 *
 * Verify signature → resolve install/binding → apply edited/closed/reopened.
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

        const text = new TextDecoder().decode(rawBody)
        let payload: unknown
        try {
          payload = JSON.parse(text) as unknown
        } catch {
          return badRequest('Webhook body must be valid JSON')
        }

        const targetResult = parseGitHubWebhookIssueTarget(payload)
        if (targetResult.isErr()) {
          return badRequest(targetResult.error.message)
        }
        if (targetResult.value === null) {
          return json({ ok: true, status: 'ignored' }, 200)
        }

        const db = await appContext.db()
        const bindingResult = await resolveGitHubWebhookBinding({
          db,
          target: targetResult.value,
        })
        const binding = bindingResult.value
        if (!binding) {
          return json({ ok: true, status: 'unbound' }, 200)
        }

        const applyResult = await applyGitHubWebhookIssueUpdate({
          db,
          binding,
          target: targetResult.value,
        })
        if (applyResult.isErr()) {
          if (applyResult.error.code === 'issue_not_found') {
            return json({ ok: true, status: 'unbound' }, 200)
          }
          return serviceUnavailable(applyResult.error.message)
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
