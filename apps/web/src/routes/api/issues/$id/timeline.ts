import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { getIssueTimeline } from '@/lib/server/issues/timeline-service'
import { serviceErrorResponse } from '@/lib/server/service-error-response'

export const Route = createFileRoute('/api/issues/$id/timeline')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access

        const timelineResult = await getIssueTimeline(access.db, access.issue)
        return timelineResult.match({
          ok: (entries) => Response.json(entries),
          err: (error) => serviceErrorResponse(error),
        })
      },
    },
  },
})
