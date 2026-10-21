import { Context, Effect, Layer } from 'effect'
import { EmbedError } from '../errors.ts'

export const EMBEDDING_DIM = 384
export const WORKERS_AI_MODEL = '@cf/baai/bge-small-en-v1.5'

export type EmbeddingsShape = {
  readonly embed: (
    texts: readonly string[],
  ) => Effect.Effect<number[][], EmbedError>
  readonly dim: number
}

export class Embeddings extends Context.Service<Embeddings, EmbeddingsShape>()(
  '@garden/brain/Embeddings',
) {}

export type WorkersAiBinding = {
  readonly run: (model: string, input: unknown) => Promise<unknown>
}

export const makeWorkersAiEmbeddings = (
  ai: WorkersAiBinding,
): EmbeddingsShape =>
  Embeddings.of({
    dim: EMBEDDING_DIM,
    embed: (texts) =>
      Effect.tryPromise({
        try: async () => {
          const result = (await ai.run(WORKERS_AI_MODEL, {
            text: texts as string[],
          })) as { readonly data: number[][] }
          if (
            !Array.isArray(result.data) ||
            result.data.length !== texts.length ||
            !result.data.every(
              (vector) =>
                Array.isArray(vector) &&
                vector.length === EMBEDDING_DIM &&
                vector.every((value) => Number.isFinite(value)),
            )
          ) {
            throw new Error('unexpected embedding response shape')
          }
          return result.data
        },
        catch: (cause) =>
          new EmbedError({ message: 'failed to embed texts', cause }),
      }),
  })

export const WorkersAiEmbeddingsLive = (
  ai: WorkersAiBinding,
): Layer.Layer<Embeddings> =>
  Layer.succeed(Embeddings, makeWorkersAiEmbeddings(ai))
