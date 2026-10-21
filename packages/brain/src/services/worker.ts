import { Effect, Layer } from 'effect'
import { ExtractError } from '../errors.ts'
import { Brain, makeBrain } from './Brain.ts'
import { WorkersAiEmbeddingsLive, type WorkersAiBinding } from './Embeddings.ts'
import { Extractor } from './ExtractorService.ts'
import { ChunkerLive } from './Chunker.ts'
import { makeHelixClientLayer } from './HelixClient.ts'
import { makeR2RawFileStoreLive, type R2BucketLike } from './RawFileStore.ts'

/**
 * Worker-safe `Brain` composition for first-party agent tools.
 *
 * `layers.ts` cannot be imported from the agent Worker: it composes
 * `LocalEmbeddingsLive` (bundles `@xenova/transformers` + onnx WASM) and
 * `ExtractorLive` (bundles exceljs/unpdf/mammoth) into the workerd bundle and
 * pulls `@effect/platform-node`. This composition swaps those for the binding-
 * backed implementations: `WorkersAiEmbeddingsLive` (`env.AI`) and an R2-backed
 * `RawFileStore`. Extraction is intentionally stubbed — the agent tools only
 * run `search` and `addText`, neither of which touches a source file.
 */
export function makeWorkerBrainLive(args: {
  baseUrl: string
  apiKey?: string
  ai: WorkersAiBinding
  files: R2BucketLike
}): Layer.Layer<Brain> {
  const workerExtractor = Layer.succeed(
    Extractor,
    Extractor.of({
      extract: () =>
        Effect.fail(
          new ExtractError({
            message: 'file extraction is not available in the worker runtime',
          }),
        ),
      extractFromBytes: () =>
        Effect.fail(
          new ExtractError({
            message: 'file extraction is not available in the worker runtime',
          }),
        ),
    }),
  )
  return Layer.effect(Brain, makeBrain).pipe(
    Layer.provide(
      makeHelixClientLayer({ baseUrl: args.baseUrl, apiKey: args.apiKey }),
    ),
    Layer.provide(WorkersAiEmbeddingsLive(args.ai)),
    Layer.provide(makeR2RawFileStoreLive(args.files)),
    Layer.provide(ChunkerLive),
    Layer.provide(workerExtractor),
  )
}
