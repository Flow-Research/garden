import { Context, Effect, Layer, Schema } from 'effect'
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http'
import { EmbedError } from '../errors.ts'

export const EMBEDDING_DIM = 384
export const WORKERS_AI_MODEL = '@cf/baai/bge-small-en-v1.5'

/**
 * OpenAI-compatible base used when local dev does not set
 * `GARDEN_MODEL_BASE_URL`. Matches the Ollama default in the root README.
 */
export const DEFAULT_OPENAI_EMBEDDING_BASE_URL = 'http://localhost:11434/v1'

/**
 * 384-d Ollama embedding model. Brain vector indexes are fixed at
 * `EMBEDDING_DIM` (same width as Workers AI `@cf/baai/bge-small-en-v1.5`).
 * `all-minilm` is the local model that fits that width. Chat model ids such
 * as `qwen3:8b` are not embedding models and must not be reused here.
 */
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'all-minilm'

const DEFAULT_EMBEDDING_TIMEOUT_SECONDS = 30

const EMBEDDINGS_ENV_KEYS = [
  'GARDEN_OFFLINE',
  'GARDEN_MODEL_BASE_URL',
  'GARDEN_MODEL_API_KEY',
  'GARDEN_EMBEDDING_MODEL',
  'GARDEN_EMBEDDING_PROVIDER',
  'GARDEN_EMBEDDING_TIMEOUT_SECONDS',
] as const

export type EmbeddingsProvider = 'workers-ai' | 'openai-compatible'

/**
 * Env slice that chooses who embeds brain text.
 *
 * Embedding selection is independent of the chat provider.
 */
export type EmbeddingsRuntimeEnv = {
  readonly GARDEN_OFFLINE?: string
  readonly GARDEN_MODEL_PROVIDER?: string
  readonly GARDEN_MODEL_BASE_URL?: string
  readonly GARDEN_MODEL_API_KEY?: string
  readonly GARDEN_EMBEDDING_MODEL?: string
  readonly GARDEN_EMBEDDING_PROVIDER?: string
  readonly GARDEN_EMBEDDING_TIMEOUT_SECONDS?: string
}

const OpenAiEmbeddingResponseSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      embedding: Schema.Array(Schema.Number),
      index: Schema.optional(Schema.Number),
    }),
  ),
})

export type EmbeddingsShape = {
  readonly maxBatchSize?: number
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

/**
 * Copies the embedding env off a Worker `env` object.
 *
 * Callers often rebuild a small Helix env and would otherwise drop
 * `GARDEN_OFFLINE` / `GARDEN_MODEL_*`. Those keys decide whether indexing
 * touches the Workers AI binding. Empty strings are kept so "unset" matches
 * wrangler's `vars` defaults (see `resolveEmbeddingsProvider`).
 */
export function embeddingsRuntimeEnv(
  env: EmbeddingsRuntimeEnv,
): EmbeddingsRuntimeEnv {
  const picked: {
    -readonly [Key in (typeof EMBEDDINGS_ENV_KEYS)[number]]?: string
  } = {}
  for (const key of EMBEDDINGS_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string') picked[key] = value
  }
  return picked
}

/**
 * Selects the embedding provider.
 *
 * An explicit embedding provider wins. Offline mode selects the local
 * endpoint only when the embedding provider is unset.
 */
export function resolveEmbeddingsProvider(
  env?: EmbeddingsRuntimeEnv,
): EmbeddingsProvider {
  const explicit = env?.GARDEN_EMBEDDING_PROVIDER?.trim()
  if (explicit === 'workers-ai' || explicit === 'openai-compatible') {
    return explicit
  }
  const offline = env?.GARDEN_OFFLINE?.trim() === '1'
  return offline ? 'openai-compatible' : 'workers-ai'
}

export type OpenAiEmbeddingsConfig = {
  readonly baseURL: string
  readonly apiKey?: string
  readonly model: string
  readonly timeoutSeconds?: number
  readonly fetch?: typeof globalThis.fetch
}

/**
 * Joins an OpenAI-compatible base such as `http://localhost:11434/v1` with
 * `/embeddings`. Query and fragment are dropped so a copied base URL cannot
 * leak extra parameters. Same URL join as `HelixClient`'s query route.
 */
const resolveEmbeddingsUrl = (baseURL: string): string => {
  const url = new URL(baseURL)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/embeddings`
  url.search = ''
  url.hash = ''
  return url.toString()
}

const embeddingFailure = (message: string, cause?: unknown) =>
  new EmbedError({
    message: `failed to embed texts: ${message}`,
    ...(cause === undefined ? {} : { cause }),
  })

const orderedEmbeddings = (
  data: ReadonlyArray<{
    readonly embedding: readonly number[]
    readonly index?: number
  }>,
) => {
  if (data.every((row) => row.index === undefined)) return data
  if (
    data.some((row) => row.index === undefined) ||
    new Set(data.map((row) => row.index)).size !== data.length ||
    data.some(
      (row) =>
        !Number.isInteger(row.index) ||
        (row.index ?? -1) < 0 ||
        (row.index ?? -1) >= data.length,
    )
  ) {
    return undefined
  }
  return [...data].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
}

/**
 * Embeds through `POST {baseURL}/embeddings`. Vectors must be
 * `EMBEDDING_DIM` wide because existing Helix indexes use that width.
 */
const embedWithOpenAi = (
  http: HttpClient.HttpClient,
  config: OpenAiEmbeddingsConfig,
) =>
  Effect.fn('Embeddings.embedOpenAi')(function* (texts: readonly string[]) {
    if (texts.length === 0) return []
    const url = yield* Effect.try({
      try: () => resolveEmbeddingsUrl(config.baseURL),
      catch: () => embeddingFailure('invalid embedding base URL'),
    })
    const body = yield* HttpBody.json({
      model: config.model,
      input: [...texts],
    }).pipe(
      Effect.mapError((cause) =>
        embeddingFailure('could not encode embedding request', cause),
      ),
    )
    const headers: Record<string, string> = {}
    if (config.apiKey !== undefined && config.apiKey !== '') {
      headers.authorization = `Bearer ${config.apiKey}`
    }
    const response = yield* http
      .execute(HttpClientRequest.post(url, { body, headers }))
      .pipe(
        Effect.mapError(() =>
          embeddingFailure('could not reach embedding endpoint'),
        ),
      )
    if (response.status < 200 || response.status >= 300) {
      const hint =
        response.status === 404
          ? ` Pull a ${EMBEDDING_DIM}-dimensional model, for example: ollama pull ${DEFAULT_OLLAMA_EMBEDDING_MODEL}`
          : ''
      return yield* Effect.fail(
        embeddingFailure(
          `embedding model "${config.model}" failed (${response.status}).${hint}`,
        ),
      )
    }
    const text = yield* response.text.pipe(
      Effect.mapError((cause) =>
        embeddingFailure(
          'embedding endpoint returned an unreadable body',
          cause,
        ),
      ),
    )
    const parsed = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        embeddingFailure('embedding endpoint returned invalid JSON', cause),
    })
    const decoded = yield* Schema.decodeUnknownEffect(
      OpenAiEmbeddingResponseSchema,
    )(parsed).pipe(
      Effect.mapError((cause) =>
        embeddingFailure('unexpected embedding response shape', cause),
      ),
    )
    const rows = orderedEmbeddings(decoded.data)
    if (rows === undefined) {
      return yield* Effect.fail(
        embeddingFailure('invalid embedding response indexes'),
      )
    }
    if (rows.length !== texts.length) {
      return yield* Effect.fail(
        embeddingFailure(
          `embedding model "${config.model}" returned ${rows.length} vectors for ${texts.length} texts`,
        ),
      )
    }
    for (const row of rows) {
      if (
        row.embedding.length !== EMBEDDING_DIM ||
        row.embedding.some((value) => !Number.isFinite(value))
      ) {
        return yield* Effect.fail(
          embeddingFailure(
            `embedding model "${config.model}" returned ${row.embedding.length}-d vectors; brain indexes are ${EMBEDDING_DIM}-d. Use ${DEFAULT_OLLAMA_EMBEDDING_MODEL} (ollama pull ${DEFAULT_OLLAMA_EMBEDDING_MODEL})`,
          ),
        )
      }
    }
    return rows.map((row) => [...row.embedding])
  })

const makeOpenAiCompatibleEmbeddings = (config: OpenAiEmbeddingsConfig) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    return Embeddings.of({
      dim: EMBEDDING_DIM,
      maxBatchSize: 16,
      embed: (texts) =>
        embedWithOpenAi(
          http,
          config,
        )(texts).pipe(
          Effect.timeout(
            `${config.timeoutSeconds ?? DEFAULT_EMBEDDING_TIMEOUT_SECONDS} seconds`,
          ),
          Effect.mapError((cause) =>
            cause instanceof EmbedError
              ? cause
              : embeddingFailure(
                  `embedding request timed out after ${config.timeoutSeconds ?? DEFAULT_EMBEDDING_TIMEOUT_SECONDS} seconds`,
                  cause,
                ),
          ),
        ),
    })
  })

export const makeOpenAiCompatibleEmbeddingsLayer = (
  config: OpenAiEmbeddingsConfig,
): Layer.Layer<Embeddings> => {
  const httpLayer = config.fetch
    ? FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(config.fetch)),
      )
    : FetchHttpClient.layer
  return Layer.effect(Embeddings, makeOpenAiCompatibleEmbeddings(config)).pipe(
    Layer.provide(httpLayer),
  )
}

/**
 * Selects Workers AI by default and local embeddings in offline mode.
 */
export function embeddingsLayerFor(args: {
  readonly ai: WorkersAiBinding
  readonly env?: EmbeddingsRuntimeEnv
  readonly fetch?: typeof globalThis.fetch
}): Layer.Layer<Embeddings> {
  if (resolveEmbeddingsProvider(args.env) === 'workers-ai') {
    return WorkersAiEmbeddingsLive(args.ai)
  }
  if (
    args.env?.GARDEN_OFFLINE?.trim() !== '1' &&
    !args.env?.GARDEN_MODEL_BASE_URL?.trim()
  ) {
    return Layer.succeed(
      Embeddings,
      Embeddings.of({
        dim: EMBEDDING_DIM,
        embed: () =>
          Effect.fail(embeddingFailure('embedding base URL is required')),
      }),
    )
  }
  const apiKey = args.env?.GARDEN_MODEL_API_KEY?.trim()
  const parsedTimeout = Number(args.env?.GARDEN_EMBEDDING_TIMEOUT_SECONDS)
  const timeoutSeconds =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_EMBEDDING_TIMEOUT_SECONDS
  return makeOpenAiCompatibleEmbeddingsLayer({
    baseURL:
      args.env?.GARDEN_MODEL_BASE_URL?.trim() ||
      DEFAULT_OPENAI_EMBEDDING_BASE_URL,
    ...(apiKey === undefined || apiKey === '' ? {} : { apiKey }),
    model:
      args.env?.GARDEN_EMBEDDING_MODEL?.trim() ||
      DEFAULT_OLLAMA_EMBEDDING_MODEL,
    timeoutSeconds,
    ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
  })
}
