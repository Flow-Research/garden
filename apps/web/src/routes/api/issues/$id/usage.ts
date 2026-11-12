import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { getIssueUsageTotals } from '@/lib/server/issues/usage-service'
import { serviceErrorResponse } from '@/lib/server/service-error-response'

export const Route = createFileRoute('/api/issues/$id/usage')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access

        const usageResult = await getIssueUsageTotals(access.db, params.id)
        return usageResult.match({
          ok: (usage) => Response.json(usage),
          err: (error) => serviceErrorResponse(error),
        })
      },
    },
  },
})
