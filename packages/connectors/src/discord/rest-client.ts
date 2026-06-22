import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
} from 'effect/unstable/http'
import {
  ConnectorAuthError,
  ConnectorDecodeError,
  ConnectorError,
  ConnectorHttpError,
  ConnectorNotFoundError,
  ConnectorPermissionError,
  ConnectorRateLimitError,
} from '../effect/errors.ts'
import {
  DiscordChannel,
  DiscordChannels,
  DiscordGuilds,
  DiscordMessages,
  DiscordSearchMessages,
  DiscordSendMessageResponse,
  type DiscordChannel as DiscordChannelValue,
  type DiscordGuild,
  type DiscordMessage as DiscordMessageValue,
} from './schemas.ts'

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10'

export type DiscordBotConfigShape = {
  readonly botToken: string
}

export class DiscordBotConfig extends Context.Service<
  DiscordBotConfig,
  DiscordBotConfigShape
>()('@garden/connectors/DiscordBotConfig') {}

export type DiscordRestClientShape = {
  readonly listServers: () => Effect.Effect<readonly DiscordGuild[], ConnectorError>
  readonly listChannels: (
    guildId: string,
  ) => Effect.Effect<readonly DiscordChannelValue[], ConnectorError>
  readonly getChannel: (
    channelId: string,
  ) => Effect.Effect<DiscordChannelValue, ConnectorError>
  readonly readMessages: (input: {
    channelId: string
    limit?: number
    before?: string
    after?: string
    around?: string
  }) => Effect.Effect<readonly DiscordMessageValue[], ConnectorError>
  readonly searchMessages: (input: {
    guildId: string
    query: string
    channelId?: string
    limit?: number
  }) => Effect.Effect<readonly DiscordMessageValue[], ConnectorError>
  readonly sendMessage: (input: {
    channelId: string
    content: string
    replyToMessageId?: string
  }) => Effect.Effect<DiscordMessageValue, ConnectorError>
  readonly createThread: (input: {
    channelId: string
    name: string
    messageId?: string
  }) => Effect.Effect<DiscordChannelValue, ConnectorError>
  readonly addReaction: (input: {
    channelId: string
    messageId: string
    emoji: string
  }) => Effect.Effect<void, ConnectorError>
  readonly listActiveThreads: (
    guildId: string,
  ) => Effect.Effect<readonly DiscordChannelValue[], ConnectorError>
}

export class DiscordRestClient extends Context.Service<
  DiscordRestClient,
  DiscordRestClientShape
>()('@garden/connectors/DiscordRestClient') {}

type RequestJsonOptions<A> = {
  readonly operation: string
  readonly method?: HttpMethod.HttpMethod
  readonly path: string
  readonly query?: Record<string, string | number | undefined>
  readonly body?: unknown
  readonly schema: Schema.Decoder<A>
}

type RequestVoidOptions = Omit<RequestJsonOptions<void>, 'schema'>

/**
 * Builds a Discord API URL from a path and primitive query map. The connector
 * owns URL creation so every tool uses the same API version and query encoding.
 */
function buildDiscordUrl(
  path: string,
  query: Record<string, string | number | undefined> = {},
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${DISCORD_API_BASE_URL}${normalizedPath}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url
}

/** Reads a bounded upstream error body through Effect's HttpClient response API. */
function readResponseText(
  response: HttpClientResponse.HttpClientResponse,
  operation: string,
) {
  return response.text.pipe(
    Effect.map((text) => text.trim().slice(0, 1_000)),
    Effect.catch(() => Effect.succeed('')),
    Effect.withSpan('connector.discord.read_error_body', {
      attributes: { 'connector.operation': operation },
    }),
  )
}

/** Converts Discord HTTP status codes into the shared connector error hierarchy. */
function errorFromResponse(
  response: HttpClientResponse.HttpClientResponse,
  operation: string,
) {
  return Effect.gen(function* () {
    const body = yield* readResponseText(response, operation)
    const message = body || `Discord returned ${response.status}`
    if (response.status === 401) {
      return yield* new ConnectorAuthError({
        connectorId: 'discord',
        operation,
        message,
        status: response.status,
      })
    }
    if (response.status === 403) {
      return yield* new ConnectorPermissionError({
        connectorId: 'discord',
        operation,
        message,
        status: response.status,
      })
    }
    if (response.status === 404) {
      return yield* new ConnectorNotFoundError({
        connectorId: 'discord',
        operation,
        message,
        status: response.status,
      })
    }
    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers['retry-after'])
      return yield* new ConnectorRateLimitError({
        connectorId: 'discord',
        operation,
        message,
        status: response.status,
        retryAfterMs: Number.isFinite(retryAfterSeconds)
          ? Math.max(0, retryAfterSeconds * 1_000)
          : undefined,
      })
    }

    return yield* new ConnectorHttpError({
      connectorId: 'discord',
      operation,
      message,
      status: response.status,
    })
  })
}

/**
 * Decodes Discord JSON through Effect Schema so malformed provider responses
 * stay typed connector failures instead of defects or nullable sentinels.
 */
function decodeDiscordJson<A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  operation: string,
) {
  const decoded = Schema.decodeUnknownOption(schema)(value)
  return Option.match(decoded, {
    onNone: () =>
      Effect.fail(
        new ConnectorDecodeError({
          connectorId: 'discord',
          operation,
          message: 'Discord response did not match the expected schema',
          cause: value,
        }),
      ),
    onSome: (decodedValue) => Effect.succeed(decodedValue),
  })
}

/** Creates an authenticated Effect HttpClient request for Discord. */
function makeDiscordRequest(
  config: DiscordBotConfigShape,
  options: RequestVoidOptions,
) {
  const request = HttpClientRequest.make(options.method ?? 'GET')(
    buildDiscordUrl(options.path, options.query),
    {
      acceptJson: true,
      headers: { authorization: `Bot ${config.botToken}` },
    },
  )

  if (options.body === undefined) return Effect.succeed(request)

  return HttpBody.json(options.body).pipe(
    Effect.map((body) => HttpClientRequest.setBody(request, body)),
    Effect.mapError(
      (cause) =>
        new ConnectorDecodeError({
          connectorId: 'discord',
          operation: options.operation,
          message: 'Failed to encode Discord request JSON body',
          cause,
        }),
    ),
  )
}

/** Performs authenticated Discord API requests and decodes JSON responses. */
function requestJson<A>(
  client: HttpClient.HttpClient,
  config: DiscordBotConfigShape,
  options: RequestJsonOptions<A>,
) {
  return Effect.gen(function* () {
    const request = yield* makeDiscordRequest(config, options)
    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new ConnectorHttpError({
            connectorId: 'discord',
            operation: options.operation,
            message: cause.message,
            cause,
          }),
      ),
    )

    if (response.status < 200 || response.status >= 300) {
      return yield* errorFromResponse(response, options.operation)
    }

    const json = yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ConnectorDecodeError({
            connectorId: 'discord',
            operation: options.operation,
            message: 'Discord response was not valid JSON',
            cause,
            status: response.status,
          }),
      ),
    )

    return yield* decodeDiscordJson(options.schema, json, options.operation)
  }).pipe(
    Effect.withSpan('connector.discord.request_json', {
      attributes: { 'connector.operation': options.operation },
    }),
  )
}

/** Performs authenticated Discord API requests where success has no body. */
function requestVoid(
  client: HttpClient.HttpClient,
  config: DiscordBotConfigShape,
  options: RequestVoidOptions,
) {
  return Effect.gen(function* () {
    const request = yield* makeDiscordRequest(config, options)
    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new ConnectorHttpError({
            connectorId: 'discord',
            operation: options.operation,
            message: cause.message,
            cause,
          }),
      ),
    )

    if (response.status < 200 || response.status >= 300) {
      return yield* errorFromResponse(response, options.operation)
    }
  }).pipe(
    Effect.withSpan('connector.discord.request_void', {
      attributes: { 'connector.operation': options.operation },
    }),
  )
}

/** Collapses Discord's nested search response into newest-first messages. */
function flattenSearchMessages(response: typeof DiscordSearchMessages.Type) {
  return response.messages.flatMap((group) => group)
}

/** Builds the service implementation from smaller request helpers. */
function makeDiscordRestClient(
  config: DiscordBotConfigShape,
  client: HttpClient.HttpClient,
): DiscordRestClientShape {
  return {
    listServers: () =>
      requestJson(client, config, {
        operation: 'discord.listServers',
        path: '/users/@me/guilds',
        schema: DiscordGuilds,
      }),
    listChannels: (guildId) =>
      requestJson(client, config, {
        operation: 'discord.listChannels',
        path: `/guilds/${encodeURIComponent(guildId)}/channels`,
        schema: DiscordChannels,
      }),
    getChannel: (channelId) =>
      requestJson(client, config, {
        operation: 'discord.getChannel',
        path: `/channels/${encodeURIComponent(channelId)}`,
        schema: DiscordChannel,
      }),
    readMessages: (input) =>
      requestJson(client, config, {
        operation: 'discord.readMessages',
        path: `/channels/${encodeURIComponent(input.channelId)}/messages`,
        query: {
          limit: input.limit,
          before: input.before,
          after: input.after,
          around: input.around,
        },
        schema: DiscordMessages,
      }),
    searchMessages: (input) =>
      requestJson(client, config, {
        operation: 'discord.searchMessages',
        path: `/guilds/${encodeURIComponent(input.guildId)}/messages/search`,
        query: {
          content: input.query,
          channel_id: input.channelId,
          limit: input.limit,
        },
        schema: DiscordSearchMessages,
      }).pipe(Effect.map(flattenSearchMessages)),
    sendMessage: (input) =>
      requestJson(client, config, {
        operation: 'discord.sendMessage',
        method: 'POST',
        path: `/channels/${encodeURIComponent(input.channelId)}/messages`,
        body: {
          content: input.content,
          ...(input.replyToMessageId
            ? {
                message_reference: {
                  message_id: input.replyToMessageId,
                  channel_id: input.channelId,
                },
              }
            : {}),
        },
        schema: DiscordSendMessageResponse,
      }),
    createThread: (input) =>
      requestJson(client, config, {
        operation: 'discord.createThread',
        method: 'POST',
        path: input.messageId
          ? `/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}/threads`
          : `/channels/${encodeURIComponent(input.channelId)}/threads`,
        body: { name: input.name },
        schema: DiscordChannel,
      }),
    addReaction: (input) =>
      requestVoid(client, config, {
        operation: 'discord.addReaction',
        method: 'PUT',
        path: `/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}/reactions/${encodeURIComponent(input.emoji)}/@me`,
      }),
    listActiveThreads: (guildId) =>
      requestJson(client, config, {
        operation: 'discord.listActiveThreads',
        path: `/guilds/${encodeURIComponent(guildId)}/threads/active`,
        schema: Schema.Struct({ threads: DiscordChannels }),
      }).pipe(Effect.map((response) => response.threads)),
  }
}

export const DiscordRestClientLive: Layer.Layer<
  DiscordRestClient,
  never,
  DiscordBotConfig | HttpClient.HttpClient
> = Layer.effect(
  DiscordRestClient,
  Effect.gen(function* () {
    const config = yield* DiscordBotConfig
    const client = yield* HttpClient.HttpClient
    return makeDiscordRestClient(config, client)
  }),
)
