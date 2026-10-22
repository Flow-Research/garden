import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { updateIssueSubscription } from '@/lib/server/issue-subscription'

export const Route = createFileRoute('/api/issues/$id/subscribe')({
  server: {
    handlers: {
      /** Joins a participant to an issue; see `updateIssueSubscription`. */
      POST: async ({ context, params }) =>
        await updateIssueSubscription({
          appContext: requireAppRequestContext(context),
          issueId: params.id,
          subscribed: true,
        }),
    },
  },
})
