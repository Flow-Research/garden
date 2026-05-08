import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import { parseSearchParams } from '@/lib/server/validation/issues'
import {
  listIssueRunEvents,
  type IssueRunServiceError,
} from '@garden/core/issues/run-service'

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
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(request, issue.workspaceId)
        if (access instanceof Response) return access

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
