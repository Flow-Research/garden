import { Context, Duration, Effect, Layer, Option, Schema } from 'effect'
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/unstable/http'
import {
  ConnectorDecodeError,
  type ConnectorError,
  ConnectorHttpError,
} from '../effect/errors.ts'
import { connectorErrorFromGitHubHttp } from './auth-errors.ts'
import {
  mintGitHubInstallationAccessToken,
  withGitHubTokenRejectedRemintOnce,
} from './installation-auth.ts'
import {
  GitHubAppConfig,
  type GitHubAppConfigShape,
} from './rest-client.ts'

const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/'
const GITHUB_MCP_TOOLSETS = 'repos,issues,pull_requests,actions'
const GITHUB_MCP_PROTOCOL_VERSION = '2025-06-18'

const JsonRpcError = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
})

const JsonRpcEnvelope = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: Schema.optional(
    Schema.Union([Schema.String, Schema.Number, Schema.Null]),
  ),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(JsonRpcError),
})

const GitHubHostedMcpToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.optional(Schema.Unknown),
  outputSchema: Schema.optional(Schema.Unknown),
})

const ToolListResult = Schema.Struct({
  tools: Schema.Array(GitHubHostedMcpToolSchema),
  nextCursor: Schema.optional(Schema.String),
})

export type GitHubHostedMcpTool = typeof GitHubHostedMcpToolSchema.Type

export type GitHubHostedMcpClientShape = {
  readonly listTools: () => Effect.Effect<
    readonly GitHubHostedMcpTool[],
    ConnectorError
  >
  readonly callTool: (
    name: string,
    argumentsValue: unknown,
  ) => Effect.Effect<unknown, ConnectorError>
}

export class GitHubHostedMcpClient extends Context.Service<
  GitHubHostedMcpClient,
  GitHubHostedMcpClientShape
>()('@garden/connectors/GitHubHostedMcpClient') {}

const responseError = Effect.fn('GitHubHostedMcp.responseError')(function* (
  response: HttpClientResponse.HttpClientResponse,
  operation: string,
) {
  const bodyText = yield* response.text.pipe(
    Effect.map((body) => body.trim().slice(0, 1_000)),
    Effect.catch(() => Effect.succeed('')),
  )
  return yield* connectorErrorFromGitHubHttp({
    operation,
    status: response.status,
    bodyText: bodyText || `GitHub MCP returned ${response.status}.`,
  })
})

const jsonPayloads = (body: string): readonly string[] => {
  const eventPayloads = body.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith('data:')) return []
    const payload = line.slice('data:'.length).trim()
    return payload.length === 0 || payload === '[DONE]' ? [] : [payload]
  })
  return eventPayloads.length > 0 ? eventPayloads : [body]
}

const decodeJsonRpcResponse = Effect.fn('GitHubHostedMcp.decodeResponse')(
  function* (body: string, operation: string) {
    const payloads = jsonPayloads(body)
    const envelopes = yield* Effect.forEach(payloads, (payload) =>
      Effect.mapError(
        Schema.decodeUnknownEffect(Schema.fromJsonString(JsonRpcEnvelope))(
          payload,
        ),
        (cause) =>
          new ConnectorDecodeError({
            connectorId: 'github',
            operation,
            message: 'GitHub MCP returned an invalid JSON-RPC response.',
            cause,
          }),
      ),
    )
    const envelope = envelopes.find(
      (candidate) =>
        candidate.result !== undefined || candidate.error !== undefined,
    )
    if (envelope === undefined) {
      return yield* new ConnectorDecodeError({
        connectorId: 'github',
        operation,
        message: 'GitHub MCP returned no JSON-RPC result.',
        cause: body,
      })
    }
    if (envelope.error !== undefined) {
      return yield* new ConnectorHttpError({
        connectorId: 'github',
        operation,
        message: envelope.error.message,
      })
    }
    return envelope.result
  },
)

const makeRequest = Effect.fn('GitHubHostedMcp.makeRequest')(function* (input: {
  readonly token: string
  readonly operation: string
  readonly body: unknown
  readonly sessionId?: string
}) {
  const body = yield* Effect.mapError(
    HttpBody.json(input.body),
    (cause) =>
      new ConnectorDecodeError({
        connectorId: 'github',
        operation: input.operation,
        message: 'GitHub MCP request body could not be encoded.',
        cause,
      }),
  )
  return HttpClientRequest.post(GITHUB_MCP_URL).pipe(
    HttpClientRequest.setHeaders({
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json',
      'user-agent': 'garden-github-app',
      'x-mcp-toolsets': GITHUB_MCP_TOOLSETS,
      ...(input.sessionId === undefined
        ? {}
        : { 'mcp-session-id': input.sessionId }),
    }),
    HttpClientRequest.setBody(body),
  )
})

const executeRequest = Effect.fn('GitHubHostedMcp.executeRequest')(
  function* (input: {
    readonly client: HttpClient.HttpClient
    readonly token: string
    readonly operation: string
    readonly body: unknown
    readonly sessionId?: string
    readonly expectsResult: boolean
  }) {
    const request = yield* makeRequest(input)
    const response = yield* Effect.mapError(
      input.client.execute(request).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(30),
          orElse: () =>
            Effect.fail(
              new ConnectorHttpError({
                connectorId: 'github',
                operation: input.operation,
                message: 'GitHub MCP request timed out.',
              }),
            ),
        }),
      ),
      (cause) =>
        cause instanceof ConnectorHttpError
          ? cause
          : new ConnectorHttpError({
              connectorId: 'github',
              operation: input.operation,
              message: 'GitHub MCP request failed.',
              cause,
            }),
    )
    if (response.status < 200 || response.status >= 300) {
      return yield* responseError(response, input.operation)
    }
    if (!input.expectsResult) {
      return { response, result: undefined }
    }
    const text = yield* Effect.mapError(
      response.text,
      (cause) =>
        new ConnectorDecodeError({
          connectorId: 'github',
          operation: input.operation,
          message: 'GitHub MCP response could not be read.',
          cause,
          status: response.status,
        }),
    )
    const result = yield* decodeJsonRpcResponse(text, input.operation)
    return { response, result }
  },
)

const initializeSession = Effect.fn('GitHubHostedMcp.initialize')(function* (
  client: HttpClient.HttpClient,
  token: string,
) {
  const initialized = yield* executeRequest({
    client,
    token,
    operation: 'github.mcp.initialize',
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: GITHUB_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'garden', version: '1.0.0' },
      },
    },
    expectsResult: true,
  })
  const sessionId = initialized.response.headers['mcp-session-id']?.trim()
  if (!sessionId) {
    return yield* new ConnectorDecodeError({
      connectorId: 'github',
      operation: 'github.mcp.initialize',
      message: 'GitHub MCP did not return a session identifier.',
    })
  }
  yield* executeRequest({
    client,
    token,
    sessionId,
    operation: 'github.mcp.initialized',
    body: {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    expectsResult: false,
  })
  return sessionId
})

const decodeToolList = Effect.fn('GitHubHostedMcp.decodeToolList')(function* (
  value: unknown,
) {
  return yield* Effect.mapError(
    Schema.decodeUnknownEffect(ToolListResult)(value),
    (cause) =>
      new ConnectorDecodeError({
        connectorId: 'github',
        operation: 'github.mcp.listTools',
        message: 'GitHub MCP returned an invalid tool manifest.',
        cause,
      }),
  )
})

export const makeGitHubHostedMcpClientLayer = (): Layer.Layer<
  GitHubHostedMcpClient,
  never,
  GitHubAppConfig | HttpClient.HttpClient
> =>
  Layer.effect(
    GitHubHostedMcpClient,
    Effect.gen(function* () {
      const config = yield* GitHubAppConfig
      const client = yield* HttpClient.HttpClient
      return GitHubHostedMcpClient.of({
        listTools: Effect.fn('GitHubHostedMcp.listTools')(function* () {
          const attempt = Effect.fn('GitHubHostedMcp.listTools.attempt')(
            function* () {
              const credential = yield* mintGitHubInstallationAccessToken(
                config,
                'github.mcp.listTools',
              )
              const token = credential.token
              const sessionId = yield* initializeSession(client, token)
              const tools: GitHubHostedMcpTool[] = []
              let cursor: string | undefined
              do {
                const response = yield* executeRequest({
                  client,
                  token,
                  sessionId,
                  operation: 'github.mcp.listTools',
                  body: {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list',
                    params: cursor === undefined ? {} : { cursor },
                  },
                  expectsResult: true,
                })
                const page = yield* decodeToolList(response.result)
                tools.push(...page.tools)
                cursor = Option.getOrUndefined(
                  Option.fromNullishOr(page.nextCursor),
                )
              } while (cursor !== undefined && cursor.length > 0)
              return tools
            },
          )
          return yield* withGitHubTokenRejectedRemintOnce(
            attempt(),
            config.installationId,
          )
        }),
        callTool: Effect.fn('GitHubHostedMcp.callTool')(function* (
          name: string,
          argumentsValue: unknown,
        ) {
          const attempt = Effect.fn('GitHubHostedMcp.callTool.attempt')(
            function* () {
              const credential = yield* mintGitHubInstallationAccessToken(
                config,
                `github.mcp.${name}`,
              )
              const token = credential.token
              const sessionId = yield* initializeSession(client, token)
              const response = yield* executeRequest({
                client,
                token,
                sessionId,
                operation: `github.mcp.${name}`,
                body: {
                  jsonrpc: '2.0',
                  id: 2,
                  method: 'tools/call',
                  params: { name, arguments: argumentsValue },
                },
                expectsResult: true,
              })
              return response.result
            },
          )
          return yield* withGitHubTokenRejectedRemintOnce(
            attempt(),
            config.installationId,
          )
        }),
      })
    }),
  )

/**
 * Provides GitHub App config + Effect HttpClient for hosted MCP. Optional
 * `fetch` swaps the transport for deterministic remint/401 tests.
 */
export const makeGitHubHostedMcpBaseLayer = (
  config: GitHubAppConfigShape,
  options?: { fetch?: typeof globalThis.fetch },
): Layer.Layer<GitHubHostedMcpClient> =>
  makeGitHubHostedMcpClientLayer().pipe(
    Layer.provide(Layer.succeed(GitHubAppConfig)(config)),
    Layer.provide(
      options?.fetch
        ? FetchHttpClient.layer.pipe(
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(options.fetch)),
          )
        : FetchHttpClient.layer,
    ),
  )
