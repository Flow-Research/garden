import { Result } from 'better-result'
import { Effect, Result as EffectResult, type Layer } from 'effect'
import { ItemId, WorkspaceId } from '@garden/brain/domain'
import { Brain } from '@garden/brain/services/brain'
import {
  embeddingsRuntimeEnv,
  type EmbeddingsRuntimeEnv,
  type WorkersAiBinding,
} from '@garden/brain/services/embeddings'
import { makeWebBrainLive } from '@garden/brain/services/web'
import type { R2BucketLike } from '@garden/brain/services/raw-file-store'
import {
  DecideAnalysisServiceError,
  type DecideAnalysisSourceReader,
} from './service'

export type BrainSourceEnvironment = {
  HELIX_URL?: string
  HELIX_API_KEY?: string
  AI: WorkersAiBinding
  BRAIN_FILES: R2BucketLike
} & EmbeddingsRuntimeEnv

const unavailable = (message: string, cause?: unknown) =>
  new DecideAnalysisServiceError({
    code: 'source_unavailable',
    message,
    ...(cause === undefined ? {} : { cause }),
  })

/**
 * Reads a `brain_file` source through `Brain.readFileItem`, the same service
 * read that backs the `brain_read_file` agent tool. Before, the model called
 * that tool and pasted the text into `decide_analyze`, so a large sheet went
 * through the model twice and could be cut short. Now Garden reads the full
 * extracted body itself (an XLSX is stored as tab-separated sheet text) with
 * the owner as viewer, so only files that user may see are readable. A missing
 * or hidden file, a file without text, and a Brain failure all return
 * `source_unavailable`; none of them creates a run.
 */
export const readBrainFileSource =
  (brain: Layer.Layer<Brain>): DecideAnalysisSourceReader =>
  async ({ workspaceId, ownerUserId, source }) => {
    const read = await Effect.runPromise(
      Effect.result(
        Effect.flatMap(Brain, (service) =>
          service.readFileItem(
            ItemId.make(source.fileId),
            WorkspaceId.make(workspaceId),
            { teamIds: new Set<string>(), userId: ownerUserId },
          ),
        ).pipe(Effect.provide(brain)),
      ),
    )
    if (EffectResult.isFailure(read)) {
      return Result.err(
        unavailable('Brain could not read the selected file.', read.failure),
      )
    }
    const item = read.success
    if (item === null) {
      return Result.err(unavailable('The Brain file is unavailable.'))
    }
    if (item.body === undefined) {
      return Result.err(
        unavailable('The Brain file has no extracted text yet.'),
      )
    }
    return Result.ok(item.body)
  }

/** Builds the Brain source reader from the Worker bindings Brain needs. */
export const makeBrainSourceReader = (
  env: BrainSourceEnvironment,
): DecideAnalysisSourceReader => {
  const helixUrl = env.HELIX_URL
  if (helixUrl === undefined) {
    return async () =>
      Result.err(unavailable('Brain is not configured (missing HELIX_URL).'))
  }
  return readBrainFileSource(
    makeWebBrainLive({
      baseUrl: helixUrl,
      apiKey: env.HELIX_API_KEY,
      ai: env.AI,
      files: env.BRAIN_FILES,
      modelEnv: embeddingsRuntimeEnv(env),
    }),
  )
}
