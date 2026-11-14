import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  issueSearchQuerySchema,
  parseSearchParams,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  requireSession,
  requireWorkspaceAccess,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { isWorkspaceManager } from '@/lib/server/team-access'
import { searchWorkspaceIssues } from '@/lib/server/issues/search-service'
import { serviceErrorResponse } from '@/lib/server/service-error-response'

export const Route = createFileRoute('/api/issues/search')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) return Response.json({ issues: [], total: 0 })

        const workspaceAccess = await requireWorkspaceAccess(
          appContext,
          workspaceId,
        )
        if (workspaceAccess instanceof Response) return workspaceAccess

        const searchResult = parseSearchParams(
          request,
          issueSearchQuerySchema,
          'Invalid issue search query',
        )
        if (searchResult.isErr()) return badRequest(searchResult.error.message)

        const q = searchResult.value.q
        const limit = searchResult.value.limit ?? 20
        const offset = searchResult.value.offset ?? 0
        const includeClosed = searchResult.value.include_closed ?? false

        if (!q) {
          return Response.json({ issues: [], total: 0 })
        }
        const searchTerms = q.toLocaleLowerCase().split(/\s+/)

        const db = await appContext.db()
        const result = await searchWorkspaceIssues(db, {
          workspaceId,
          viewerId: session.user.id,
          manager: isWorkspaceManager(workspaceAccess.membership.role),
          searchTerms,
          includeClosed,
          limit,
          offset,
        })
        return result.match({
          ok: (page) => Response.json(page),
          err: (error) => serviceErrorResponse(error),
        })
      },
    },
  },
})
