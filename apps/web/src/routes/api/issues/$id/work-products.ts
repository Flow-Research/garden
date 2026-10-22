
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'

import { appEnv } from '@/lib/server/env'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import { listIssueWorkProducts } from '@garden/server/issues/run-service'

export const Route = createFileRoute('/api/issues/$id/work-products')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const issue = access.issue

        const workProductsResult = await listIssueWorkProducts({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
        })
        if (workProductsResult.isErr())
          return serviceErrorResponse(workProductsResult.error)

        return Response.json(workProductsResult.value)
      },
    },
  },
})
