import { Effect, Layer } from 'effect'
import { ExtractError } from '../errors.ts'
import { Brain, makeBrain } from './Brain.ts'
import {
  embeddingsLayerFor,
  type EmbeddingsRuntimeEnv,
  type WorkersAiBinding,
} from './Embeddings.ts'
import { Extractor, formatOf, type ExtractedDoc } from './ExtractorService.ts'
import { extractText, titleFromPath } from './Extractor.ts'
import { ChunkerLive } from './Chunker.ts'
import { makeHelixClientLayer } from './HelixClient.ts'
import { makeR2RawFileStoreLive, type R2BucketLike } from './RawFileStore.ts'

export const WebExtractorLive = Layer.succeed(
  Extractor,
  Extractor.of({
    extract: () =>
      Effect.fail(
        new ExtractError({
          message:
            'file extraction from the filesystem is not available in the worker runtime',
        }),
      ),
    extractFromBytes: (path, bytes) =>
      Effect.gen(function* () {
        const format = formatOf(path)
        if (format === null) {
          return yield* Effect.fail(
            new ExtractError({ message: `unsupported file type: ${path}` }),
          )
        }
        const body = yield* extractText(path, bytes, format)
        const doc: ExtractedDoc = {
          path,
          title: titleFromPath(path),
          body,
          format,
        }
        return doc
      }),
  }),
)

/**
 * Web Worker brain layer.
 *
 * Before: embeddings always used `env.AI`. Local Ollama runs
 * (`pnpm dev:offline`) disable remote bindings, so file indexing failed with
 * `Binding AI needs to be run remotely`. After: `modelEnv` selects Ollama's
 * OpenAI-compatible embeddings endpoint in that mode and Workers AI otherwise.
 * Pass `embeddingsRuntimeEnv(env)` from the request env so the flags survive.
 */
export function makeWebBrainLive(args: {
  baseUrl: string
  apiKey?: string
  ai: WorkersAiBinding
  files: R2BucketLike
  modelEnv?: EmbeddingsRuntimeEnv
}): Layer.Layer<Brain> {
  return Layer.effect(Brain, makeBrain).pipe(
    Layer.provide(
      makeHelixClientLayer({ baseUrl: args.baseUrl, apiKey: args.apiKey }),
    ),
    Layer.provide(embeddingsLayerFor({ ai: args.ai, env: args.modelEnv })),
    Layer.provide(makeR2RawFileStoreLive(args.files)),
    Layer.provide(ChunkerLive),
    Layer.provide(WebExtractorLive),
  )
}
