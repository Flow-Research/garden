import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { updateIssueSubscription } from '@/lib/server/issue-subscription'

export const Route = createFileRoute('/api/issues/$id/unsubscribe')({
  server: {
    handlers: {
      /** Removes a participant from an issue; see `updateIssueSubscription`. */
      POST: async ({ context, params }) =>
        await updateIssueSubscription({
          appContext: requireAppRequestContext(context),
          issueId: params.id,
          subscribed: false,
        }),
    },
  },
})
