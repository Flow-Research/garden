import { DateTime, Effect, Layer, Result as EffectResult } from 'effect'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, eq } from 'drizzle-orm'
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
import { getDb, schema } from '@/lib/server/db'

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
 * Stores one file in a workspace's Files & Folders. `POST /api/brain/files`
 * and work-product approval share this one path: stage to R2, adopt as a
 * Brain file item, then index and audit in the background, which keeps saved
 * work products searchable like any upload.
 */
export async function saveBrainFileUpload(args: {
  env: AppEnv
  file: File
  workProductId?: string
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
          workProductId: args.workProductId,
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

  // A partial earlier save can leave bytes in Brain before the folder link
  // and save event are recorded. Reconcile the body on that same item.
  if (args.workProductId && added.r2Key !== r2Key) {
    const existing = await overwriteBrainFile({
      env: args.env,
      fileId: added.id,
      body: await args.file.text(),
      ownerUserId: args.ownerUserId,
      waitUntil: args.waitUntil,
      workspaceId: args.workspaceId,
    })
    return existing.andThen((item) =>
      item
        ? Result.ok(item)
        : Result.err(
            new BrainFileUploadError({
              code: 'upload_failed',
              message:
                'The saved work product file disappeared. Retry saving to Files.',
            }),
          ),
    )
  }

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
 * R2 and replaces the file's sections. `replaceFileContent` records the new
 * byte size and update time so Files does not show the old size. Returns `null` when the file no longer
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
  if (
    item.origin.actor._tag !== 'Human' ||
    item.origin.actor.userId !== args.ownerUserId ||
    (item.scope?.kind === 'user' && item.scope.userId !== args.ownerUserId)
  ) {
    return Result.ok(null)
  }
  if (item.scope?.kind === 'team') {
    const teamId = item.scope.teamId
    const membership = await Result.tryPromise({
      try: async () => {
        const db = await getDb(args.env)
        return db
          .select({ teamId: schema.teamMember.teamId })
          .from(schema.teamMember)
          .where(
            and(
              eq(schema.teamMember.workspaceId, args.workspaceId),
              eq(schema.teamMember.teamId, teamId),
              eq(schema.teamMember.userId, args.ownerUserId),
            ),
          )
          .limit(1)
      },
      catch: failed,
    })
    if (membership.isErr()) return Result.err(membership.error)
    if (membership.value.length === 0) return Result.ok(null)
  }

  const r2Key = item.r2Key
  const bytes = new TextEncoder().encode(args.body)
  const put = await Result.tryPromise({
    try: () =>
      args.env.BRAIN_FILES.put(r2Key, bytes, {
        httpMetadata: {
          contentType: 'text/markdown',
          contentDisposition: buildContentDisposition('inline', item.label),
        },
      }),
    catch: failed,
  })
  if (put.isErr()) return Result.err(put.error)

  const at = await Effect.runPromise(DateTime.now)
  const replaced = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(Brain, (brain) =>
        brain.replaceFileContent({
          itemId: item.id,
          tenantId: WorkspaceId.make(args.workspaceId),
          sizeBytes: bytes.byteLength,
          at,
        }),
      ).pipe(Effect.provide(brainLive)),
    ),
  )
  if (EffectResult.isFailure(replaced)) {
    return Result.err(failed(replaced.failure))
  }
  if (replaced.success === null) return Result.ok(null)

  scheduleIndex({
    itemId: item.id,
    ownerUserId: args.ownerUserId,
    waitUntil: args.waitUntil,
    workspaceId: args.workspaceId,
  })
  return Result.ok(replaced.success)
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
