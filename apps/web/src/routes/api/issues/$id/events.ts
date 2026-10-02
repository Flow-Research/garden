
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { z } from 'zod'

import { appEnv } from '@/lib/server/env'
import {
  badRequest,
} from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { parseSearchParams } from '@/lib/server/validation/issues'
import {
  listIssueRunEvents,
  type IssueRunServiceError,
} from '@garden/server/issues/run-service'

const eventsSearchSchema = z.object({
  run_id: z.string().uuid().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

function runError(error: IssueRunServiceError) {
  return badRequest(error.message)
}

export const Route = createFileRoute('/api/issues/$id/events')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
                const issue = access.issue

        const searchResult = parseSearchParams(
          request,
          eventsSearchSchema,
          'Invalid run events query',
        )
        if (searchResult.isErr()) return badRequest(searchResult.error.message)

        const eventsResult = await listIssueRunEvents({
          env: appEnv,
          workspaceId: issue.workspaceId,
          issueId: params.id,
          runId: searchResult.value.run_id,
          after: searchResult.value.after,
          limit: searchResult.value.limit,
        })
        if (eventsResult.isErr()) return runError(eventsResult.error)
        return Response.json(eventsResult.value)
      },
    },
  },
})
