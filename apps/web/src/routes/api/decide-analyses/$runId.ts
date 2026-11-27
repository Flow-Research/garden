import { z } from 'zod'
import type { DecideAnalysisSnapshot } from '@garden/agent-runtime'
import { createFileRoute } from '@tanstack/react-router'
import type { Result as ResultValue } from 'better-result'
import { appEnv } from '@/lib/server/env'
import { badRequest, notFound } from '@/lib/server/control-plane'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'
import {
  requireWorkspaceMember,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import { parseJsonBody } from '@/lib/server/validation/common'
import {
  cancelDecideAnalysis,
  readDecideAnalysis,
  retryDecideAnalysis,
  toPublicDecideAnalysis,
  type DecideAnalysisActor,
  type DecideAnalysisServiceError,
} from '@/lib/server/decide-analysis/service'

const actionSchema = z.object({
  action: z.enum(['cancel', 'retry']),
  retry_key: z.string().min(1).optional(),
})

const serviceResponse = (
  result: ResultValue<DecideAnalysisSnapshot, DecideAnalysisServiceError>,
) =>
  result.match({
    ok: (snapshot) => Response.json(toPublicDecideAnalysis(snapshot)),
    err: (error) =>
      Response.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === 'not_found'
              ? 404
              : error.code === 'invalid_input'
                ? 400
                : error.code === 'conflict'
                  ? 409
                  : 503,
        },
      ),
  })

/**
 * Authorizes a caller for one Decide run, whatever owns it. Before, the only
 * status route lived under a chat thread, so a run owned by an automation
 * run had no route and the run page could not show its card. Now the run is
 * read first, then the caller must be a member of its workspace. A chat run
 * stays private to the user who owns the thread, as under the thread route.
 * An automation run belongs to the workspace like the run page that shows
 * it; changing it (`mutate`) needs `automationManage`, the permission that
 * runs the automation. A run the caller may not see reads as not found.
 * Returns the snapshot and the actor this run implies for cancel and retry.
 */
async function authorize(
  appContext: AppRequestContext,
  runId: string,
  mode: 'read' | 'mutate',
): Promise<
  Response | { snapshot: DecideAnalysisSnapshot; actor: DecideAnalysisActor }
> {
  const read = await readDecideAnalysis(appEnv, runId)
  if (read.isErr()) return serviceResponse(read)
  const snapshot = read.value
  const access = await requireWorkspaceMember(
    appContext,
    snapshot.workspaceId,
    snapshot.owner.kind === 'automation_run' && mode === 'mutate'
      ? workspacePermissions.automationManage
      : undefined,
  )
  if (access instanceof Response) return access
  if (
    snapshot.owner.kind === 'chat' &&
    snapshot.ownerUserId !== access.session.user.id
  ) {
    return notFound('Decide analysis run not found.')
  }
  return {
    snapshot,
    actor: {
      workspaceId: snapshot.workspaceId,
      ownerUserId: snapshot.ownerUserId,
      owner: snapshot.owner,
    },
  }
}

/** Returns the browser-safe status of one Decide run. */
export async function getDecideAnalysisStatus(
  appContext: AppRequestContext,
  runId: string,
) {
  const access = await authorize(appContext, runId, 'read')
  if (access instanceof Response) return access
  return Response.json(toPublicDecideAnalysis(access.snapshot))
}

/** Cancels or retries one Decide run as its owner. */
export async function postDecideAnalysisAction(
  appContext: AppRequestContext,
  runId: string,
) {
  const access = await authorize(appContext, runId, 'mutate')
  if (access instanceof Response) return access

  const body = await parseJsonBody(
    appContext.request,
    actionSchema,
    'Invalid Decide analysis action',
  )
  if (body.isErr()) return badRequest(body.error.message)

  if (body.value.action === 'cancel') {
    return serviceResponse(
      await cancelDecideAnalysis(appEnv, access.actor, runId),
    )
  }
  if (body.value.retry_key === undefined) {
    return badRequest('retry_key is required for a retry')
  }
  return serviceResponse(
    await retryDecideAnalysis({
      env: appEnv,
      ...access.actor,
      runId,
      retryKey: body.value.retry_key,
    }),
  )
}

export const Route = createFileRoute('/api/decide-analyses/$runId')({
  server: {
    handlers: {
      GET: async ({ context, params }) =>
        await getDecideAnalysisStatus(
          requireAppRequestContext(context),
          params.runId,
        ),
      POST: async ({ context, params }) =>
        await postDecideAnalysisAction(
          requireAppRequestContext(context),
          params.runId,
        ),
    },
  },
})
