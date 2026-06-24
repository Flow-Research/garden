import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { listIssueSubscribers } from '@garden/db/subscribers'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'

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
        const db = await appContext.db()
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(appContext, issue.workspaceId)
        if (access instanceof Response) return access

        const subscribers = await listIssueSubscribers(db, { issueId: params.id })

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
