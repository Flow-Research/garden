import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import type { AppRequestContext } from '@/lib/server/context'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { getIssuePendingApproval as getIssuePendingApprovalPage } from '@/lib/server/issues/pending-approval-service'
import { serviceErrorResponse } from '@/lib/server/service-error-response'

/**
 * Returns the newest pending approval preview for an issue's active run.
 *
 * Before (#297): only `requireWorkspaceContext` ran, so any workspace member
 * could read a Team issue's approval preview. After: uses the same
 * `requireIssueAccess` Team visibility check as the other issue subresources
 * (see `@/lib/server/issue-access.ts`). Query/mapping live in
 * `pending-approval-service` so this route stays free of Drizzle.
 */
export const getIssuePendingApproval = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const access = await requireIssueAccess(appContext, params.id)
  if (access instanceof Response) return access

  const result = await getIssuePendingApprovalPage(access.db, {
    activeRunId: access.issue.activeRunId,
  })
  return result.match({
    ok: (page) => Response.json(page),
    err: (error) => serviceErrorResponse(error),
  })
}

export const Route = createFileRoute('/api/issues/$id/pending-approval')({
  server: {
    handlers: {
      GET: getIssuePendingApproval,
    },
  },
})
