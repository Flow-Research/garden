import { createFileRoute } from '@tanstack/react-router'
import type { Result as ResultValue } from 'better-result'
import { requireAppRequestContext } from '@/lib/server/context'
import { getThreadAccess } from '@/lib/server/chat-threads'
import {
  listDecideAnalyses,
  type DecideAnalysisServiceError,
} from '@/lib/server/decide-analysis/service'

const serviceResponse = <T>(
  result: ResultValue<T, DecideAnalysisServiceError>,
) => {
  if (result.isErr()) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      {
        status:
          result.error.code === 'not_found'
            ? 404
            : result.error.code === 'invalid_input'
              ? 400
              : 503,
      },
    )
  }
  return Response.json({ runs: result.value })
}

export const Route = createFileRoute(
  '/api/chat/threads/$threadId/decide-analyses',
)({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await getThreadAccess(appContext, params.threadId)
        if (access instanceof Response) return access

        return serviceResponse(
          await listDecideAnalyses(appContext.env, {
            workspaceId: access.thread.workspaceId,
            ownerUserId: access.session.user.id,
            threadId: access.thread.id,
          }),
        )
      },
    },
  },
})
