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
  parseGitHubWebhookIssueTarget,
  resolveGitHubWebhookBinding,
} from '@/lib/server/github-webhook-resolve'

/**
 * GitHub App webhook ingress (#161).
 *
 * Step 2: verify `X-Hub-Signature-256`.
 * Step 3: map installation → workspace and look up `issue_source_binding`.
 * Unmatched deliveries still return 200 so GitHub does not retry forever.
 * Issue apply (title/body/status) lands in a later step.
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

        return json(
          {
            ok: true,
            status: 'matched',
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
