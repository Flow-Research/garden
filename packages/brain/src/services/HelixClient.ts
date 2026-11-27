import { Context, Effect, Layer, Schema } from 'effect'
import { HttpBody, HttpClient, HttpClientRequest } from 'effect/unstable/http'
import { FetchHttpClient } from 'effect/unstable/http'
import { parseJson } from '@helix-db/helix-db'
import type { QueryRequest } from '@helix-db/helix-db'
import { HelixError, WriteConflict } from '../errors.ts'

const QueryResponseSchema = Schema.Record(Schema.String, Schema.Unknown)
export type QueryResponse = typeof QueryResponseSchema.Type

const PLANNER_ERROR = 'unsupported cascades plan'
const REQUEST_TIMEOUT = '30 seconds'

export type RunOptions = {
  readonly awaitDurability?: boolean
}

export type HelixClientShape = {
  readonly run: (
    request: QueryRequest,
    options?: RunOptions,
  ) => Effect.Effect<QueryResponse, HelixError | WriteConflict>
}

export class HelixClient extends Context.Service<
  HelixClient,
  HelixClientShape
>()('@garden/brain/HelixClient') {}

const isPlannerError = (error: HelixError | WriteConflict): boolean =>
  error instanceof HelixError &&
  error.status === 400 &&
  error.message.includes(PLANNER_ERROR)

/**
 * Resolves Helix's query route beneath any configured base path. Previously an
 * absolute `/v2/query` discarded prefixes used by hosted gateways; URL parsing
 * follows the platform URL implementation and clears base query/fragment data.
 */
const resolveQueryUrl = (baseUrl: string): string => {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v2/query`
  url.search = ''
  url.hash = ''
  return url.toString()
}

/**
 * Executes one Helix HTTP request with a bounded end-to-end deadline. Before,
 * a stalled fetch or response body could hold a worker indefinitely; the
 * 30-second bound matches Garden's established outbound connector HTTP bound.
 * Effect timeout interrupts the FetchHttpClient request and maps it to HelixError.
 */
const runOnce = (
  baseUrl: string,
  apiKey: string | undefined,
  http: HttpClient.HttpClient,
  request: QueryRequest,
  options: RunOptions | undefined,
) =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => resolveQueryUrl(baseUrl),
      catch: (cause) =>
        new HelixError({ message: 'invalid Helix base URL', cause }),
    })
    const headers: Record<string, string> = {}
    if (apiKey !== undefined) headers['authorization'] = `Bearer ${apiKey}`
    if (options?.awaitDurability === true) {
      headers['x-helix-await-durable'] = 'true'
    }
    const response = yield* http.execute(
      HttpClientRequest.post(url, {
        body: HttpBody.uint8Array(request.toJsonBytes(), 'application/json'),
        headers,
      }),
    )
    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(
        Effect.catch(() => Effect.succeed('')),
      )
      const message = `helix query failed (${response.status}): ${body.slice(0, 1000)}`
      return yield* Effect.fail(
        response.status === 409
          ? new WriteConflict({ message })
          : new HelixError({ message, status: response.status }),
      )
    }
    const text = yield* response.text
    const parsed = yield* Effect.try({
      try: () => parseJson(text),
      catch: (cause) =>
        new HelixError({
          message: 'helix returned an invalid JSON response',
          cause,
          status: response.status,
        }),
    })
    return yield* Schema.decodeUnknownEffect(QueryResponseSchema)(parsed).pipe(
      Effect.mapError(
        (cause) =>
          new HelixError({
            message: 'helix returned an invalid response shape',
            cause,
            status: response.status,
          }),
      ),
    )
  }).pipe(
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.mapError((error) => {
      if (error instanceof HelixError || error instanceof WriteConflict) {
        return error
      }
      if (error._tag === 'TimeoutError') {
        return new HelixError({
          message: `helix query timed out after ${REQUEST_TIMEOUT}`,
        })
      }
      return new HelixError({ message: 'helix request failed', cause: error })
    }),
  )

const runWithRetry = (
  baseUrl: string,
  apiKey: string | undefined,
  http: HttpClient.HttpClient,
  request: QueryRequest,
  options: RunOptions | undefined,
) =>
  Effect.retry(runOnce(baseUrl, apiKey, http, request, options), {
    times: 1,
    while: isPlannerError,
  })

export type HelixClientConfigShape = {
  readonly baseUrl: string
  readonly apiKey?: string
}

const makeHelixClient = Effect.gen(function* () {
  const config = yield* HelixClientConfig
  const http = yield* HttpClient.HttpClient
  return HelixClient.of({
    run: (request, options) =>
      runWithRetry(config.baseUrl, config.apiKey, http, request, options),
  })
})

export class HelixClientConfig extends Context.Service<
  HelixClientConfigShape,
  HelixClientConfigShape
>()('@garden/brain/HelixClientConfig') {}

export const HelixClientLive: Layer.Layer<
  HelixClient,
  never,
  HelixClientConfigShape | HttpClient.HttpClient
> = Layer.effect(HelixClient, makeHelixClient)

export function makeHelixClientLayer(args: {
  baseUrl: string
  apiKey?: string
  fetch?: typeof globalThis.fetch
}) {
  const configLayer = Layer.succeed(HelixClientConfig)({
    baseUrl: args.baseUrl,
    ...(args.apiKey === undefined ? {} : { apiKey: args.apiKey }),
  })
  const httpLayer = args.fetch
    ? FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(args.fetch)),
      )
    : FetchHttpClient.layer
  return HelixClientLive.pipe(
    Layer.provide(configLayer),
    Layer.provide(httpLayer),
  )
}
