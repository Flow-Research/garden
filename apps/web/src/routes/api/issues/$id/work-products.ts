
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'

import { appEnv } from '@/lib/server/env'
import {
  badRequest,
} from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import {
  listIssueWorkProducts,
  type IssueRunServiceError,
} from '@garden/server/issues/run-service'

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

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
          return runError(workProductsResult.error)

        return Response.json(workProductsResult.value)
      },
    },
  },
})
