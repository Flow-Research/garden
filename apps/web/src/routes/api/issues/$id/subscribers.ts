import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { listIssueSubscriberRows } from '@/lib/server/queries/issues'

export const Route = createFileRoute('/api/issues/$id/subscribers')({
  server: {
    handlers: {
      /**
       * List an issue's participants. Reads the persisted issue_subscriber table
       * (creator, assignee, commenters, mentioned agents/members, manual joins)
       * and merges in the derived creator+assignee for resilience — see
       * `@garden/db/subscribers#listIssueSubscribers` via
       * `listIssueSubscriberRows`. Previously this computed creator+assignee on
       * the fly with no backing table.
       */
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access

        const subscribers = await listIssueSubscriberRows(
          access.db,
          params.id,
        )

        return Response.json(
          subscribers.map((subscriber) => ({
            issue_id: subscriber.issueId,
            user_type: subscriber.userType,
            user_id: subscriber.userId,
            reason: subscriber.reason,
            created_at: subscriber.createdAt.toISOString(),
          })),
        )
      },
    },
  },
})
