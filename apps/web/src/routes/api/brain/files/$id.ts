import { Cause, Effect, Layer, Result as EffectResult } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { ItemId, WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import {
  BrainFileIdSchema,
  BrainFileResponseSchema,
  brainFileStatusOf,
} from '@/features/brain/contract'
import {
  brainFileSummaryOf,
  loadBrainFileOwnerNames,
} from '@/lib/server/brain-file-summary'
import { deleteBrainFolderMembershipsByFileId } from '@/lib/server/brain-folders'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'
import {
  badRequest,
  notFound,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import { makeBrainAuditClientLayer } from '@/lib/server/brain-audit-runtime'
import {
  BrainFileIngestion,
  makeBrainFileIngestionLayer,
} from '@/lib/server/brain-file-ingestion'

const brainFileLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'brain-files-api',
})

const logRetryPreparationFailure = (
  operation: 'readFileItem' | 'updateIndexStatus',
  input: {
    itemId: string
    workspaceId: string
  },
  cause: Cause.Cause<unknown>,
) =>
  Effect.sync(() => {
    brainFileLogger.error('brain file retry preparation failed', {
      operation,
      itemId: input.itemId,
      workspaceId: input.workspaceId,
      ...errorFields(Cause.squash(cause)),
    })
  })

/**
 * Returns the public status of one file in the active workspace. `readFileItem`
 * prevents another Brain node type from passing through this file endpoint.
 */
export const getBrainFileStatus = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext
  const itemIdResult = BrainFileIdSchema.safeParse(params.id)
  if (!itemIdResult.success) return badRequest('Invalid Brain file id')
  const itemId = ItemId.make(itemIdResult.data)

  const env = appContext.env
  const helixUrl = env.HELIX_URL

  if (helixUrl === undefined) {
    return badRequest('Brain is not configured (missing HELIX_URL)')
  }

  const brainLive = makeWebBrainLive({
    baseUrl: helixUrl,
    apiKey: env.HELIX_API_KEY,
    ai: env.AI,
    files: env.BRAIN_FILES,
  })

  const readResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        brain.readFileItem(
          itemId,
          WorkspaceId.make(workspaceContext.workspaceId),
        ),
      ).pipe(Effect.provide(brainLive)),
    ),
  )

  if (EffectResult.isFailure(readResult)) {
    return Response.json(
      { error: 'Brain file status is unavailable' },
      { status: 503 },
    )
  }

  const item = readResult.success
  if (item === null) return notFound('Brain file not found')

  const ownerNames = await loadBrainFileOwnerNames({
    env: appContext.env,
    items: [item],
  })
  const body = BrainFileResponseSchema.parse({
    item: brainFileSummaryOf(item, ownerNames),
  })

  return Response.json(body, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Marks one non-ready file as processing, then schedules indexing through the
 * Worker request context. This follows the existing upload route's `waitUntil`
 * pattern in `apps/web/src/routes/api/brain/files.ts`.
 */
export const retryBrainFileIndexing = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext
  const itemIdResult = BrainFileIdSchema.safeParse(params.id)
  if (!itemIdResult.success) return badRequest('Invalid Brain file id')
  const itemId = ItemId.make(itemIdResult.data)

  const retryContext = {
    itemId: params.id,
    workspaceId: workspaceContext.workspaceId,
  }

  const env = appContext.env
  const helixUrl = env.HELIX_URL
  if (helixUrl === undefined) {
    return badRequest('Brain is not configured (missing HELIX_URL)')
  }

  const brainLive = makeWebBrainLive({
    baseUrl: helixUrl,
    apiKey: env.HELIX_API_KEY,
    ai: env.AI,
    files: env.BRAIN_FILES,
  })

  const prepareResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        Effect.gen(function* () {
          const item = yield* brain
            .readFileItem(
              itemId,
              WorkspaceId.make(workspaceContext.workspaceId),
            )
            .pipe(
              Effect.tapCause((cause) =>
                logRetryPreparationFailure('readFileItem', retryContext, cause),
              ),
            )

          if (item === null || brainFileStatusOf(item) === 'ready') return item

          return yield* brain
            .updateIndexStatus({
              itemId: item.id,
              tenantId: item.tenantId,
              status: 'processing',
            })
            .pipe(
              Effect.tapCause((cause) =>
                logRetryPreparationFailure(
                  'updateIndexStatus',
                  retryContext,
                  cause,
                ),
              ),
            )
        }),
      ).pipe(Effect.provide(brainLive)),
    ),
  )

  if (EffectResult.isFailure(prepareResult)) {
    return Response.json(
      { error: 'Brain file retry is unavailable' },
      { status: 503 },
    )
  }

  const item = prepareResult.success
  if (item === null) return notFound('Brain file not found')

  const status = brainFileStatusOf(item)
  if (status !== 'ready') {
    const ingestionLive = makeBrainFileIngestionLayer(env).pipe(
      Layer.provide(
        Layer.merge(brainLive, makeBrainAuditClientLayer(env.AgentDO)),
      ),
    )
    const waitUntil = appContext.waitUntil ?? (() => {})
    waitUntil(
      Effect.runPromise(
        Effect.flatMap(BrainFileIngestion, (ingestion) =>
          ingestion.indexAndAudit({
            itemId: item.id,
            ownerUserId: workspaceContext.session.user.id,
            workspaceId: workspaceContext.workspaceId,
          }),
        ).pipe(Effect.provide(ingestionLive)),
      ),
    )
  }

  const ownerNames = await loadBrainFileOwnerNames({
    env: appContext.env,
    items: [item],
  })
  const body = BrainFileResponseSchema.parse({
    item: { ...brainFileSummaryOf(item, ownerNames), status },
  })

  return Response.json(body, { status: status === 'ready' ? 200 : 202 })
}

/**
 * Deletes the workspace-scoped Helix file first, then removes its private R2
 * object. The deleted item supplies the server-only R2 key. An R2 cleanup
 * failure is logged because the inaccessible orphan does not restore the file.
 *
 * Cloudflare R2 reference:
 * https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 */
export const deleteBrainFile = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext
  const itemIdResult = BrainFileIdSchema.safeParse(params.id)
  if (!itemIdResult.success) return badRequest('Invalid Brain file id')
  const itemId = ItemId.make(itemIdResult.data)

  const env = appContext.env
  const helixUrl = env.HELIX_URL
  if (helixUrl === undefined) {
    return badRequest('Brain is not configured (missing HELIX_URL)')
  }

  const brainLive = makeWebBrainLive({
    baseUrl: helixUrl,
    apiKey: env.HELIX_API_KEY,
    ai: env.AI,
    files: env.BRAIN_FILES,
  })
  const deleteResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        brain.deleteFile(
          itemId,
          WorkspaceId.make(workspaceContext.workspaceId),
        ),
      ).pipe(Effect.provide(brainLive)),
    ),
  )

  if (EffectResult.isFailure(deleteResult)) {
    return Response.json(
      { error: 'Brain file deletion is unavailable' },
      { status: 503 },
    )
  }

  const deleted = deleteResult.success
  if (deleted === null) return notFound('Brain file not found')

  const r2Key = deleted.r2Key

  if (r2Key !== undefined) {
    const cleanupResult = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise({
          try: () => env.BRAIN_FILES.delete(r2Key),
          catch: (cause) => cause,
        }),
      ),
    )
    if (EffectResult.isFailure(cleanupResult)) {
      brainFileLogger.error('brain file R2 cleanup failed', {
        itemId: deleted.id,
        workspaceId: workspaceContext.workspaceId,
        ...errorFields(cleanupResult.failure),
      })
    }
  }

  // Drop the file's folder membership rows so card counts can't drift from
  // the detail view. Failure must not fail the request — the file IS deleted.
  const membershipCleanup = await Effect.runPromise(
    Effect.result(
      Effect.tryPromise({
        try: () =>
          deleteBrainFolderMembershipsByFileId({
            env,
            workspaceId: workspaceContext.workspaceId,
            fileId: deleted.id,
          }),
        catch: (cause) => cause,
      }),
    ),
  )
  if (EffectResult.isFailure(membershipCleanup)) {
    brainFileLogger.error('brain file folder-membership cleanup failed', {
      itemId: deleted.id,
      workspaceId: workspaceContext.workspaceId,
      ...errorFields(membershipCleanup.failure),
    })
  }

  return new Response(null, { status: 204 })
}

export const Route = createFileRoute('/api/brain/files/$id')({
  server: {
    handlers: {
      DELETE: deleteBrainFile,
      GET: getBrainFileStatus,
      POST: retryBrainFileIndexing,
    },
  },
})
