import { createFileRoute } from '@tanstack/react-router'
import {
  badRequest,
  json,
  serviceUnavailable,
  unauthorized,
} from '@/lib/server/control-plane'
import { appEnv } from '@/lib/server/env'
import { verifyGitHubWebhookSignature } from '@/lib/server/github-webhook'

/**
 * GitHub App webhook ingress (#161 step 2).
 *
 * Verifies `X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET` over the raw
 * body, then acknowledges. Event apply (binding lookup, issue updates) comes
 * in later steps — GitHub only needs a 2xx after a valid delivery.
 */
export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        return json({ ok: true }, 200)
      },
    },
  },
})
