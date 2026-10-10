
import { createFileRoute } from '@tanstack/react-router'
import { listIssueSubscribers } from '@garden/db/subscribers'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireIssueAccess } from '@/lib/server/issue-access'


export const Route = createFileRoute('/api/issues/$id/subscribers')({
  server: {
    handlers: {
      /**
       * List an issue's participants. Reads the persisted issue_subscriber table
       * (creator, assignee, commenters, mentioned agents/members, manual joins)
       * and merges in the derived creator+assignee for resilience — see
       * @garden/db/subscribers#listIssueSubscribers. Previously this computed
       * creator+assignee on the fly with no backing table.
       */
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const db = access.db
        
        const subscribers = await listIssueSubscribers(db, {
          issueId: params.id,
        })

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
