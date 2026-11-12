import { Effect, Layer, Result as EffectResult } from 'effect'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { normalizeDownloadFilename } from '@garden/agent-runtime'
import type { BrainItem } from '@garden/brain/domain'
import { makeWebBrainLive } from '@garden/brain/services/web'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import { makeBrainAuditClientLayer } from '@/lib/server/brain-audit-runtime'
import {
  BrainFileIngestion,
  makeBrainFileIngestionLayer,
} from '@/lib/server/brain-file-ingestion'
import type { AppEnv } from '@/lib/server/env'

const brainFileUploadLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'brain-file-upload',
})

export class BrainFileUploadError extends TaggedError('BrainFileUploadError')<{
  code: 'brain_unconfigured' | 'upload_failed'
  message: string
}>() {}

/** R2 key layout shared by every Brain file write in a workspace. */
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
 * Stores one file in a workspace's Files & Folders. Before #381 this lived
 * inline in `POST /api/brain/files`, so the only way into Files was a manual
 * upload. "Save to Files" for an approved work product now needs the same
 * write, so both callers share this one path: stage to R2, adopt as a Brain
 * file item, then index and audit in the background (the upload behaviour),
 * which keeps saved work products searchable like any upload.
 */
export async function saveBrainFileUpload(args: {
  env: AppEnv
  file: File
  ownerUserId: string
  waitUntil?: (promise: Promise<unknown>) => void
  workspaceId: string
}): Promise<ResultValue<BrainItem, BrainFileUploadError>> {
  const helixUrl = args.env.HELIX_URL
  if (helixUrl === undefined) {
    return Result.err(
      new BrainFileUploadError({
        code: 'brain_unconfigured',
        message: 'Brain is not configured (missing HELIX_URL)',
      }),
    )
  }

  const itemId = crypto.randomUUID()
  const r2Key = brainStorageKey({
    workspaceId: args.workspaceId,
    itemId,
    filename: args.file.name,
  })
  const brainLive = makeWebBrainLive({
    baseUrl: helixUrl,
    apiKey: args.env.HELIX_API_KEY,
    ai: args.env.AI,
    files: args.env.BRAIN_FILES,
  })
  const ingestionLive = makeBrainFileIngestionLayer(args.env).pipe(
    Layer.provide(
      Layer.merge(brainLive, makeBrainAuditClientLayer(args.env.AgentDO)),
    ),
  )
  const stageResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(BrainFileIngestion, (ingestion) =>
        ingestion.stage({
          file: args.file,
          itemId,
          ownerUserId: args.ownerUserId,
          r2Key,
          workspaceId: args.workspaceId,
        }),
      ).pipe(Effect.provide(ingestionLive)),
    ),
  )
  if (EffectResult.isFailure(stageResult)) {
    brainFileUploadLogger.error('brain file staging failed', {
      operation: stageResult.failure.operation,
      workspaceId: args.workspaceId,
      ...errorFields(stageResult.failure),
    })
    return Result.err(
      new BrainFileUploadError({
        code: 'upload_failed',
        message: 'Brain upload is unavailable',
      }),
    )
  }
  const added = stageResult.success

  if (!added.indexed) {
    const waitUntil = args.waitUntil ?? (() => {})
    waitUntil(
      Effect.runPromise(
        Effect.flatMap(BrainFileIngestion, (ingestion) =>
          ingestion.indexAndAudit({
            itemId: added.id,
            ownerUserId: args.ownerUserId,
            workspaceId: args.workspaceId,
          }),
        ).pipe(Effect.provide(ingestionLive)),
      ),
    )
  }

  return Result.ok(added)
}
