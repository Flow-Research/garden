import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/$id/subscribers')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {

        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [issue] = await db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(appContext, issue.workspaceId)
        if (access instanceof Response) return access

        const subscribers = [
          {
            issue_id: issue.id,
            user_type: 'member',
            user_id: issue.createdBy,
            reason: 'creator',
            created_at: (issue.createdAt ?? new Date()).toISOString(),
          },
          ...(issue.assigneeType === 'user' && issue.assigneeId
            ? [
                {
                  issue_id: issue.id,
                  user_type: 'member',
                  user_id: issue.assigneeId,
                  reason: 'assignee',
                  created_at: (issue.updatedAt ?? issue.createdAt ?? new Date()).toISOString(),
                },
              ]
            : []),
          ...(issue.assigneeType === 'agent' && issue.assigneeId
            ? [
                {
                  issue_id: issue.id,
                  user_type: 'agent',
                  user_id: issue.assigneeId,
                  reason: 'assignee',
                  created_at: (issue.updatedAt ?? issue.createdAt ?? new Date()).toISOString(),
                },
              ]
            : []),
        ]

        return Response.json(
          subscribers.filter(
            (subscriber, index, items) =>
              items.findIndex(
                (candidate) =>
                  candidate.user_type === subscriber.user_type &&
                  candidate.user_id === subscriber.user_id,
              ) === index,
          ),
        )
      },
    },
  },
})
