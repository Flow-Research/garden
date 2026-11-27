import { Effect } from 'effect'
import { expect, it } from '@effect/vitest'
import { g, readBatch } from '@helix-db/helix-db'
import {
  HelixClient,
  makeHelixClientLayer,
} from '../src/services/HelixClient.ts'
import { HelixError, WriteConflict } from '../src/errors.ts'

it.effect('preserves a Helix base URL path prefix', () => {
  let requestedUrl: string | undefined
  let authorization: string | null = null
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requestedUrl =
      input instanceof Request
        ? input.url
        : new URL(input.toString()).toString()
    authorization = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    ).get('authorization')
    return Response.json({})
  }
  const request = readBatch()
    .varAs('count', g().n([]).count())
    .returning(['count'])
    .toQueryRequest({ queryName: 'test.path_prefix' })

  return Effect.gen(function* () {
    const helix = yield* HelixClient
    yield* helix.run(request)
    expect(requestedUrl).toBe(
      'https://helix.example.com/gateway/tenant/v2/query',
    )
    expect(authorization).toBe('Bearer test-key')
  }).pipe(
    Effect.provide(
      makeHelixClientLayer({
        baseUrl:
          'https://helix.example.com/gateway/tenant?source=test#fragment',
        apiKey: 'test-key',
        fetch,
      }),
    ),
  )
})

it.effect('maps Helix conflicts into WriteConflict', () => {
  const fetch: typeof globalThis.fetch = async () =>
    new Response('write conflict', { status: 409 })
  const request = readBatch()
    .varAs('count', g().n([]).count())
    .returning(['count'])
    .toQueryRequest({ queryName: 'test.write_conflict' })

  return Effect.gen(function* () {
    const helix = yield* HelixClient
    const error = yield* Effect.flip(helix.run(request))

    expect(error).toBeInstanceOf(WriteConflict)
  }).pipe(
    Effect.provide(
      makeHelixClientLayer({
        baseUrl: 'https://helix.example.com',
        fetch,
      }),
    ),
  )
})

it.effect('maps malformed Helix JSON into HelixError', () => {
  const fetch: typeof globalThis.fetch = async () =>
    new Response('not-json', { status: 200 })
  const request = readBatch()
    .varAs('count', g().n([]).count())
    .returning(['count'])
    .toQueryRequest({ queryName: 'test.invalid_json' })

  return Effect.gen(function* () {
    const helix = yield* HelixClient
    const error = yield* Effect.flip(helix.run(request))

    expect(error).toBeInstanceOf(HelixError)
    expect(error.message).toContain('invalid JSON response')
  }).pipe(
    Effect.provide(
      makeHelixClientLayer({
        baseUrl: 'https://helix.example.com',
        fetch,
      }),
    ),
  )
})
