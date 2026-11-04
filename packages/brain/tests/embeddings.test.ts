import { Effect } from 'effect'
import { expect, it } from '@effect/vitest'
import { describe } from 'vitest'
import { EmbedError } from '../src/errors.ts'
import {
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  EMBEDDING_DIM,
  Embeddings,
  embeddingsLayerFor,
  resolveEmbeddingsProvider,
} from '../src/services/Embeddings.ts'

const vector = (seed: number) =>
  Array.from({ length: EMBEDDING_DIM }, (_, index) => (seed + index) / 1000)

describe('resolveEmbeddingsProvider', () => {
  it('keeps Workers AI when offline mode is unset', () => {
    expect(resolveEmbeddingsProvider()).toBe('workers-ai')
    expect(resolveEmbeddingsProvider({})).toBe('workers-ai')
    expect(resolveEmbeddingsProvider({ GARDEN_OFFLINE: '' })).toBe('workers-ai')
    expect(resolveEmbeddingsProvider({ GARDEN_OFFLINE: '   ' })).toBe(
      'workers-ai',
    )
  })

  it('follows explicit chat provider, then offline mode', () => {
    expect(
      resolveEmbeddingsProvider({ GARDEN_MODEL_PROVIDER: 'openai-compatible' }),
    ).toBe('openai-compatible')
    expect(
      resolveEmbeddingsProvider({
        GARDEN_MODEL_PROVIDER: 'workers-ai',
        GARDEN_OFFLINE: '1',
      }),
    ).toBe('workers-ai')
    expect(resolveEmbeddingsProvider({ GARDEN_OFFLINE: '1' })).toBe(
      'openai-compatible',
    )
  })

  it('lets the embedding provider override the chat provider', () => {
    expect(
      resolveEmbeddingsProvider({
        GARDEN_OFFLINE: '1',
        GARDEN_EMBEDDING_PROVIDER: 'workers-ai',
      }),
    ).toBe('workers-ai')
    expect(
      resolveEmbeddingsProvider({
        GARDEN_EMBEDDING_PROVIDER: 'openai-compatible',
      }),
    ).toBe('openai-compatible')
    expect(
      resolveEmbeddingsProvider({
        GARDEN_EMBEDDING_PROVIDER: 'nope',
        GARDEN_OFFLINE: '',
      }),
    ).toBe('workers-ai')
  })
})

it.effect('embeds through the OpenAI-compatible endpoint when offline', () => {
  let requestedUrl = ''
  let authorization: string | null = null
  let body = ''
  let aiCalled = false
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requestedUrl = request.url
    authorization = request.headers.get('authorization')
    body = await request.text()
    return Response.json({
      data: [
        { index: 1, embedding: vector(2) },
        { index: 0, embedding: vector(1) },
      ],
    })
  }

  return Effect.gen(function* () {
    const embeddings = yield* Embeddings
    const rows = yield* embeddings.embed(['second', 'first'])
    expect(aiCalled).toBe(false)
    expect(requestedUrl).toBe('http://embeddings.test/gateway/v1/embeddings')
    expect(authorization).toBe('Bearer secret')
    expect(JSON.parse(body)).toEqual({
      model: 'all-minilm',
      input: ['second', 'first'],
    })
    expect(rows[0]).toEqual(vector(1))
    expect(rows[1]).toEqual(vector(2))
  }).pipe(
    Effect.provide(
      embeddingsLayerFor({
        ai: {
          run: async () => {
            aiCalled = true
            throw new Error('Binding AI needs to be run remotely')
          },
        },
        env: {
          GARDEN_OFFLINE: '1',
          GARDEN_MODEL_BASE_URL:
            'http://embeddings.test/gateway/v1?unused=1#fragment',
          GARDEN_MODEL_API_KEY: 'secret',
        },
        fetch: fetchImpl,
      }),
    ),
  )
})

it.effect('names a missing Ollama model instead of calling Workers AI', () => {
  const fetchImpl: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'model not found' } }), {
      status: 404,
    })

  return Effect.gen(function* () {
    const embeddings = yield* Embeddings
    const error = yield* Effect.flip(embeddings.embed(['notes']))
    expect(error).toBeInstanceOf(EmbedError)
    expect(error.message).toContain(DEFAULT_OLLAMA_EMBEDDING_MODEL)
    expect(error.message).toContain('ollama pull')
    expect(error.message).toContain('404')
  }).pipe(
    Effect.provide(
      embeddingsLayerFor({
        ai: {
          run: async () => {
            throw new Error('Binding AI needs to be run remotely')
          },
        },
        env: { GARDEN_MODEL_PROVIDER: 'openai-compatible' },
        fetch: fetchImpl,
      }),
    ),
  )
})

it.effect('rejects vectors that do not match the brain index width', () => {
  const fetchImpl: typeof globalThis.fetch = async () =>
    Response.json({
      data: [{ index: 0, embedding: [1, 2, 3] }],
    })

  return Effect.gen(function* () {
    const embeddings = yield* Embeddings
    const error = yield* Effect.flip(embeddings.embed(['notes']))
    expect(error.message).toContain(`${EMBEDDING_DIM}-d`)
    expect(error.message).toContain('3-d')
  }).pipe(
    Effect.provide(
      embeddingsLayerFor({
        ai: { run: async () => ({ data: [] }) },
        env: { GARDEN_OFFLINE: '1' },
        fetch: fetchImpl,
      }),
    ),
  )
})

it.effect(
  'keeps the Workers AI binding when offline embeddings are overridden',
  () => {
    let model = ''
    return Effect.gen(function* () {
      const embeddings = yield* Embeddings
      const rows = yield* embeddings.embed(['notes'])
      expect(model).toBe('@cf/baai/bge-small-en-v1.5')
      expect(rows).toEqual([vector(4)])
    }).pipe(
      Effect.provide(
        embeddingsLayerFor({
          ai: {
            run: async (nextModel, input) => {
              model = nextModel
              const text =
                typeof input === 'object' && input !== null && 'text' in input
                  ? input.text
                  : []
              const texts = Array.isArray(text) ? text : []
              return { data: texts.map(() => vector(4)) }
            },
          },
          env: {
            GARDEN_OFFLINE: '1',
            GARDEN_EMBEDDING_PROVIDER: 'workers-ai',
          },
          fetch: async () => {
            throw new Error('openai embeddings should not be called')
          },
        }),
      ),
    )
  },
)
