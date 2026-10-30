import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import type { Result as ResultValue } from 'better-result'
import { requireAppRequestContext } from '@/lib/server/context'
import { badRequest } from '@/lib/server/control-plane'
import { getThreadAccess } from '@/lib/server/chat-threads'
import {
  cancelDecideAnalysis,
  getDecideAnalysis,
  retryDecideAnalysis,
  type DecideAnalysisServiceError,
} from '@/lib/server/decide-analysis/service'

const actionSchema = z.object({
  action: z.enum(['cancel', 'retry']),
  retry_key: z.string().min(1).optional(),
})

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
              : result.error.code === 'conflict'
                ? 409
                : 503,
      },
    )
  }
  return Response.json(result.value)
}

export const Route = createFileRoute(
  '/api/chat/threads/$threadId/decide-analyses/$runId',
)({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await getThreadAccess(appContext, params.threadId)
        if (access instanceof Response) return access

        return serviceResponse(
          await getDecideAnalysis(
            appContext.env,
            {
              workspaceId: access.thread.workspaceId,
              ownerUserId: access.session.user.id,
              threadId: access.thread.id,
            },
            params.runId,
          ),
        )
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await getThreadAccess(appContext, params.threadId)
        if (access instanceof Response) return access

        const bodyResult = await import('@/lib/server/validation/chat').then(
          ({ parseJsonBody }) =>
            parseJsonBody(
              request,
              actionSchema,
              'Invalid Decide analysis action',
            ),
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)

        const actor = {
          workspaceId: access.thread.workspaceId,
          ownerUserId: access.session.user.id,
          threadId: access.thread.id,
        }
        const result =
          bodyResult.value.action === 'cancel'
            ? await cancelDecideAnalysis(appContext.env, actor, params.runId)
            : bodyResult.value.retry_key === undefined
              ? null
              : await retryDecideAnalysis({
                  env: appContext.env,
                  ...actor,
                  runId: params.runId,
                  retryKey: bodyResult.value.retry_key,
                })

        return result === null
          ? badRequest('retry_key is required for a retry')
          : serviceResponse(result)
      },
    },
  },
})
