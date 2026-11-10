import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import type { AppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import { getIssuePendingApproval as getIssuePendingApprovalPage } from '@/lib/server/issues/pending-approval-service'
import { serviceErrorResponse } from '@/lib/server/service-error-response'

export const getIssuePendingApproval = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const db = await appContext.db()
  const result = await getIssuePendingApprovalPage(db, {
    workspaceId: workspaceContext.workspaceId,
    issueId: params.id,
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
