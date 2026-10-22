import { Effect, Layer, Result as EffectResult } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { MAX_FILE_SIZE } from '@garden/core/constants/upload'
import { normalizeDownloadFilename } from '@garden/agent-runtime'
import { WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import { formatOf } from '@garden/brain/services/extractor'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import {
  BrainFileListResponseSchema,
  BrainFileResponseSchema,
} from '@/features/brain/contract'
import {
  brainFileSummaryOf,
  loadBrainFileOwnerNames,
} from '@/lib/server/brain-file-summary'
import {
  requireAppRequestContext,
  type AppRequestContext,
} from '@/lib/server/context'
import { badRequest, requireWorkspaceContext } from '@/lib/server/control-plane'
import {
  multipartErrorResponse,
  readMultipartForm,
} from '@/lib/server/multipart'
import { makeBrainAuditClientLayer } from '@/lib/server/brain-audit-runtime'
import {
  BrainFileIngestion,
  makeBrainFileIngestionLayer,
} from '@/lib/server/brain-file-ingestion'

const brainFilesLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'brain-files-api',
})

function brainStorageKey(input: {
  workspaceId: string
  itemId: string
  filename: string
}) {
  return [
    'brain',
    'workspaces',
    input.workspaceId,
    input.itemId,
    normalizeDownloadFilename(input.filename),
  ].join('/')
}

/**
 * Lists files stored in the active workspace. The response exposes only fields
 * required by the Files page and disables caching so reloads show current state.
 */
export const getBrainFiles = async ({
  context,
}: {
  context: AppRequestContext
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

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

  const listResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        brain.listFiles({
          tenantId: WorkspaceId.make(workspaceContext.workspaceId),
        }),
      ).pipe(Effect.provide(brainLive)),
    ),
  )

  if (EffectResult.isFailure(listResult)) {
    return Response.json(
      { error: 'Brain files are unavailable' },
      { status: 503 },
    )
  }

  const ownerNames = await loadBrainFileOwnerNames({
    env: appContext.env,
    items: listResult.success,
  })
  const body = BrainFileListResponseSchema.parse({
    items: listResult.success.map((item) =>
      brainFileSummaryOf(item, ownerNames),
    ),
  })

  return Response.json(body, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Thin TanStack Start boundary for static Brain ingestion. Form parsing and
 * HTTP validation stay here; upload adoption, cleanup, indexing, and agent
 * audit run through the request-provided Effect service layer.
 */
export const postBrainFileUpload = async ({
  context,
  request,
}: {
  context: AppRequestContext
  request: Request
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const env = appContext.env
  const helixUrl = env.HELIX_URL
  if (helixUrl === undefined) {
    return badRequest('Brain is not configured (missing HELIX_URL)')
  }

  const formResult = await readMultipartForm(request, MAX_FILE_SIZE)
  if (formResult.isErr()) return multipartErrorResponse(formResult.error)

  const file = formResult.value.get('file')
  if (!(file instanceof File)) return badRequest('Missing file')
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: 'File exceeds 100 MB limit' },
      { status: 413 },
    )
  }
  if (formatOf(file.name) === null)
    return badRequest(`Unsupported file type: ${file.name}`)

  const itemId = crypto.randomUUID()
  const r2Key = brainStorageKey({
    workspaceId: workspaceContext.workspaceId,
    itemId,
    filename: file.name,
  })
  const brainLive = makeWebBrainLive({
    baseUrl: helixUrl,
    apiKey: env.HELIX_API_KEY,
    ai: env.AI,
    files: env.BRAIN_FILES,
  })
  const ingestionLive = makeBrainFileIngestionLayer(env).pipe(
    Layer.provide(
      Layer.merge(brainLive, makeBrainAuditClientLayer(env.AgentDO)),
    ),
  )
  const stageResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(BrainFileIngestion, (ingestion) =>
        ingestion.stage({
          file,
          itemId,
          ownerUserId: workspaceContext.session.user.id,
          r2Key,
          workspaceId: workspaceContext.workspaceId,
        }),
      ).pipe(Effect.provide(ingestionLive)),
    ),
  )
  if (EffectResult.isFailure(stageResult)) {
    brainFilesLogger.error('brain file staging failed', {
      operation: stageResult.failure.operation,
      workspaceId: workspaceContext.workspaceId,
      ...errorFields(stageResult.failure),
    })
    return Response.json(
      { error: 'Brain upload is unavailable' },
      { status: 503 },
    )
  }
  const added = stageResult.success

  if (!added.indexed) {
    const waitUntil = appContext.waitUntil ?? (() => {})
    waitUntil(
      Effect.runPromise(
        Effect.flatMap(BrainFileIngestion, (ingestion) =>
          ingestion.indexAndAudit({
            itemId: added.id,
            ownerUserId: workspaceContext.session.user.id,
            workspaceId: workspaceContext.workspaceId,
          }),
        ).pipe(Effect.provide(ingestionLive)),
      ),
    )
  }

  const body = BrainFileResponseSchema.parse({
    item: brainFileSummaryOf(added),
  })

  return Response.json(body, { status: 201 })
}

export const Route = createFileRoute('/api/brain/files')({
  server: {
    handlers: {
      GET: getBrainFiles,
      POST: postBrainFileUpload,
    },
  },
})
