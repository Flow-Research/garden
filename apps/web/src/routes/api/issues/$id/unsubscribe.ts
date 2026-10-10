
import { createFileRoute } from '@tanstack/react-router'
import { setIssueSubscription } from '@garden/db/subscribers'
import { requireAppRequestContext } from '@/lib/server/context'

import {
  badRequest,
} from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'

export const Route = createFileRoute('/api/issues/$id/unsubscribe')({
  server: {
    handlers: {
      /**
       * Remove a participant from an issue. Body may target another participant
       * (`user_id` + `user_type`); absent, it unsubscribes the current member.
       * Deletes the issue_subscriber row. Backs the previously no-op route.
       */
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const db = access.db
        const issue = access.issue

        const body = (await request.json().catch(() => ({}))) as {
          user_id?: string
          user_type?: string
        }
        const userType = body.user_type === 'agent' ? 'agent' : 'member'
        const userId = body.user_id ?? access.session.user.id
        if (!userId) return badRequest('Missing participant id')

        await setIssueSubscription(db, {
          workspaceId: issue.workspaceId,
          issueId: params.id,
          userType,
          userId,
          subscribed: false,
        })

        return new Response(null, { status: 204 })
      },
    },
  },
})
