import { Context, Effect, Layer } from 'effect'
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
} from 'effect/unstable/http'
import {
  ConnectorDecodeError,
  type ConnectorError,
  ConnectorHttpError,
} from '../effect/errors.ts'
import { connectorErrorFromGitHubHttp } from './auth-errors.ts'
import { mintGitHubInstallationAccessToken } from './installation-auth.ts'

const GITHUB_API_BASE_URL = 'https://api.github.com'

export type GitHubAppConfigShape = {
  readonly appId?: string
  readonly clientId?: string
  readonly privateKey?: string
  readonly installationId: string
}

export class GitHubAppConfig extends Context.Service<
  GitHubAppConfig,
  GitHubAppConfigShape
>()('@garden/connectors/GitHubAppConfig') {}

export type GitHubRequest = {
  readonly operation: string
  readonly method?: HttpMethod.HttpMethod
  readonly path: string
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >
  readonly body?: unknown
}

export type GitHubRestClientShape = {
  readonly request: (
    input: GitHubRequest,
  ) => Effect.Effect<unknown, ConnectorError>
}

export class GitHubRestClient extends Context.Service<
  GitHubRestClient,
  GitHubRestClientShape
>()('@garden/connectors/GitHubRestClient') {}

const githubUrl = (input: GitHubRequest): string => {
  const url = new URL(input.path, GITHUB_API_BASE_URL)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

const makeRequest = Effect.fn('GitHubRestClient.makeRequest')(function* (
  token: string,
  input: GitHubRequest,
) {
  let request = HttpClientRequest.make(input.method ?? 'GET')(
    githubUrl(input),
    {
      acceptJson: true,
      headers: {
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'garden-github-app',
      },
    },
  )
  if (input.body !== undefined) {
    const body = yield* Effect.mapError(
      HttpBody.json(input.body),
      (cause) =>
        new ConnectorDecodeError({
          connectorId: 'github',
          operation: input.operation,
          message: 'GitHub request body could not be encoded.',
          cause,
        }),
    )
    request = HttpClientRequest.setBody(request, body)
  }
  return request
})

/**
 * Reads a truncated error body so 401/403 can carry GitHub's message into
 * classified auth errors instead of a bare status code.
 */
const readErrorBody = (
  response: HttpClientResponse.HttpClientResponse,
  operation: string,
) =>
  response.text.pipe(
    Effect.map((body) => body.trim().slice(0, 1_000)),
    Effect.catch(() => Effect.succeed('')),
    Effect.withSpan('connector.github.read_error_body', {
      attributes: { 'connector.operation': operation },
    }),
  )

export const makeGitHubRestClientLayer = (): Layer.Layer<
  GitHubRestClient,
  never,
  GitHubAppConfig | HttpClient.HttpClient
> =>
  Layer.effect(
    GitHubRestClient,
    Effect.gen(function* () {
      const config = yield* GitHubAppConfig
      const client = yield* HttpClient.HttpClient
      return {
        request: Effect.fn('GitHubRestClient.request')(function* (
          input: GitHubRequest,
        ) {
          const credential = yield* mintGitHubInstallationAccessToken(
            config,
            input.operation,
          )
          const request = yield* makeRequest(credential.token, input)
          const response = yield* Effect.mapError(
            client.execute(request),
            (cause) =>
              new ConnectorHttpError({
                connectorId: 'github',
                operation: input.operation,
                message: 'GitHub API request failed.',
                cause,
              }),
          )
          if (response.status < 200 || response.status >= 300) {
            const bodyText = yield* readErrorBody(response, input.operation)
            return yield* connectorErrorFromGitHubHttp({
              operation: input.operation,
              status: response.status,
              bodyText,
            })
          }
          if (response.status === 204) return null
          return yield* Effect.mapError(
            response.json,
            (cause) =>
              new ConnectorDecodeError({
                connectorId: 'github',
                operation: input.operation,
                message: 'GitHub API returned invalid JSON.',
                cause,
                status: response.status,
              }),
          )
        }),
      }
    }),
  )

export const makeGitHubBaseLayer = (
  config: GitHubAppConfigShape,
): Layer.Layer<GitHubRestClient> =>
  makeGitHubRestClientLayer().pipe(
    Layer.provide(Layer.succeed(GitHubAppConfig)(config)),
    Layer.provide(FetchHttpClient.layer),
  )
