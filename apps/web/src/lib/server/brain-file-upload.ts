import { Effect, Layer, Result as EffectResult } from 'effect'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import {
  buildContentDisposition,
  normalizeDownloadFilename,
} from '@garden/agent-runtime'
import { ItemId, WorkspaceId, type BrainItem } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
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
  const runtime = brainRuntime(args.env)
  if (runtime.isErr()) return Result.err(runtime.error)
  const { ingestionLive, scheduleIndex } = runtime.value

  const itemId = crypto.randomUUID()
  const r2Key = brainStorageKey({
    workspaceId: args.workspaceId,
    itemId,
    filename: args.file.name,
  })
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
    scheduleIndex({
      itemId: added.id,
      ownerUserId: args.ownerUserId,
      waitUntil: args.waitUntil,
      workspaceId: args.workspaceId,
    })
  }

  return Result.ok(added)
}

/**
 * Replaces the bytes of an existing Markdown file in place and re-indexes it
 * (#381 re-save). Before, a revised and re-approved work product could only
 * be saved as a second file, leaving the stale copy searchable. Now the same
 * file id and R2 key get the new body, and `indexAndAudit` re-extracts from
 * R2 and replaces the file's sections. Returns `null` when the file no longer
 * exists in this workspace (deleted from Files), so the caller saves anew.
 */
export async function overwriteBrainFile(args: {
  env: AppEnv
  fileId: string
  body: string
  ownerUserId: string
  waitUntil?: (promise: Promise<unknown>) => void
  workspaceId: string
}): Promise<ResultValue<BrainItem | null, BrainFileUploadError>> {
  const runtime = brainRuntime(args.env)
  if (runtime.isErr()) return Result.err(runtime.error)
  const { brainLive, scheduleIndex } = runtime.value

  const failed = (cause: unknown) => {
    brainFileUploadLogger.error('brain file overwrite failed', {
      fileId: args.fileId,
      workspaceId: args.workspaceId,
      ...errorFields(cause),
    })
    return new BrainFileUploadError({
      code: 'upload_failed',
      message: 'Brain upload is unavailable',
    })
  }

  const readResult = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        brain.readFileItem(
          ItemId.make(args.fileId),
          WorkspaceId.make(args.workspaceId),
        ),
      ).pipe(Effect.provide(brainLive)),
    ),
  )
  if (EffectResult.isFailure(readResult)) {
    return Result.err(failed(readResult.failure))
  }
  const item = readResult.success
  if (item === null || item.r2Key === undefined) return Result.ok(null)

  const r2Key = item.r2Key
  const put = await Result.tryPromise({
    try: () =>
      args.env.BRAIN_FILES.put(r2Key, args.body, {
        httpMetadata: {
          contentType: 'text/markdown',
          contentDisposition: buildContentDisposition('inline', item.label),
        },
      }),
    catch: failed,
  })
  if (put.isErr()) return Result.err(put.error)

  scheduleIndex({
    itemId: item.id,
    ownerUserId: args.ownerUserId,
    waitUntil: args.waitUntil,
    workspaceId: args.workspaceId,
  })
  return Result.ok(item)
}

/**
 * Builds the Brain and ingestion layers both writers need, and the deferred
 * index → audit step uploads already run after responding.
 */
function brainRuntime(env: AppEnv) {
  const helixUrl = env.HELIX_URL
  if (helixUrl === undefined) {
    return Result.err(
      new BrainFileUploadError({
        code: 'brain_unconfigured',
        message: 'Brain is not configured (missing HELIX_URL)',
      }),
    )
  }
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
  const scheduleIndex = (input: {
    itemId: string
    ownerUserId: string
    waitUntil?: (promise: Promise<unknown>) => void
    workspaceId: string
  }) => {
    const waitUntil = input.waitUntil ?? (() => {})
    waitUntil(
      Effect.runPromise(
        Effect.flatMap(BrainFileIngestion, (ingestion) =>
          ingestion.indexAndAudit({
            itemId: input.itemId,
            ownerUserId: input.ownerUserId,
            workspaceId: input.workspaceId,
          }),
        ).pipe(Effect.provide(ingestionLive)),
      ),
    )
  }
  return Result.ok({ brainLive, ingestionLive, scheduleIndex })
}
