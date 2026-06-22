import { Effect, Option, Schema } from 'effect'
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  UrlParams,
} from 'effect/unstable/http'
import {
  ConnectorConfigError,
  ConnectorDecodeError,
  ConnectorError,
  ConnectorHttpError,
} from '../effect/errors.ts'
import { DiscordGuild } from './schemas.ts'

const DISCORD_AUTHORIZATION_URL = 'https://discord.com/oauth2/authorize'
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10'
const DISCORD_SETUP_STATE_TTL_MS = 15 * 60 * 1_000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const DISCORD_DEFAULT_INSTALL_SCOPES = [
  'bot',
  'applications.commands',
  'identify',
] as const

export const DISCORD_DEFAULT_BOT_PERMISSIONS = String(
  64n + // Add Reactions
    1024n + // View Channel
    2048n + // Send Messages
    65536n + // Read Message History
    34_359_738_368n + // Create Public Threads
    68_719_476_736n + // Create Private Threads
    274_877_906_944n, // Send Messages in Threads
)

const DiscordSetupStatePayload = Schema.Struct({
  userId: Schema.String,
  workspaceId: Schema.String,
  issuedAt: Schema.Number,
  flowId: Schema.optional(Schema.String),
})

export type DiscordSetupStatePayload = typeof DiscordSetupStatePayload.Type

export const DiscordInstallTokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optional(Schema.String),
  scope: Schema.String,
  guild: Schema.optional(DiscordGuild),
})

export type DiscordInstallTokenResponse =
  typeof DiscordInstallTokenResponse.Type

export type DiscordInstallConfig = {
  readonly clientId: string
  readonly clientSecret: string
  readonly botToken: string
  readonly redirectUri: string
  readonly permissions?: string | undefined
}

export function requireDiscordInstallConfig(input: {
  readonly clientId?: string | undefined
  readonly clientSecret?: string | undefined
  readonly botToken?: string | undefined
  readonly redirectUri: string
  readonly permissions?: string | undefined
}) {
  const clientId = input.clientId?.trim()
  const clientSecret = input.clientSecret?.trim()
  const botToken = input.botToken?.trim()
  const redirectUri = input.redirectUri.trim()

  if (!clientId || !clientSecret || !botToken || !redirectUri) {
    return Effect.fail(
      new ConnectorConfigError({
        connectorId: 'discord',
        operation: 'install.configure',
        message:
          'Discord install requires DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, and a redirect URI',
      }),
    )
  }

  return Effect.succeed({
    clientId,
    clientSecret,
    botToken,
    redirectUri,
    permissions:
      input.permissions?.trim() || DISCORD_DEFAULT_BOT_PERMISSIONS,
  } satisfies DiscordInstallConfig)
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)

  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string) {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function signSetupState(secret: string, payload: string) {
  return Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        textEncoder.encode(payload),
      )
      return base64Url(new Uint8Array(signature))
    },
    catch: (cause) =>
      new ConnectorConfigError({
        connectorId: 'discord',
        operation: 'install.sign_state',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to sign Discord install state',
        cause,
      }),
  })
}

function constantTimeEquals(left: string, right: string) {
  if (left.length !== right.length) return false

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return diff === 0
}

/**
 * Creates the signed CSRF state for Discord's advanced bot authorization flow.
 * Discord's bot-only flow is callback-less; Garden includes `identify` to force
 * the code callback so install state can be persisted atomically for a workspace.
 */
export function createDiscordSetupState(args: {
  readonly secret: string
  readonly userId: string
  readonly workspaceId: string
  readonly flowId?: string | null
}) {
  return Effect.gen(function* () {
    const payload = base64Url(
      textEncoder.encode(
        JSON.stringify({
          userId: args.userId,
          workspaceId: args.workspaceId,
          issuedAt: Date.now(),
          ...(args.flowId ? { flowId: args.flowId } : {}),
        }),
      ),
    )
    const signature = yield* signSetupState(args.secret, payload)
    return `${payload}.${signature}`
  })
}

/** Validates Discord callback state and decodes the workspace/user binding. */
export function resolveDiscordSetupState(args: {
  readonly secret: string
  readonly state: string
}) {
  return Effect.gen(function* () {
    const [payload, signature] = args.state.split('.')
    if (!payload || !signature) {
      return yield* new ConnectorConfigError({
        connectorId: 'discord',
        operation: 'install.resolve_state',
        message: 'Discord setup state is invalid',
      })
    }

    const expectedSignature = yield* signSetupState(args.secret, payload)
    if (!constantTimeEquals(expectedSignature, signature)) {
      return yield* new ConnectorConfigError({
        connectorId: 'discord',
        operation: 'install.resolve_state',
        message: 'Discord setup state signature is invalid',
      })
    }

    const decoded = yield* Effect.try({
      try: () => JSON.parse(textDecoder.decode(decodeBase64Url(payload))),
      catch: (cause) =>
        new ConnectorDecodeError({
          connectorId: 'discord',
          operation: 'install.resolve_state',
          message:
            cause instanceof Error
              ? cause.message
              : 'Discord setup state is not valid JSON',
          cause,
        }),
    })

    const parsed = Schema.decodeUnknownOption(DiscordSetupStatePayload)(decoded)
    const statePayload = yield* Option.match(parsed, {
      onNone: () =>
        Effect.fail(
          new ConnectorDecodeError({
            connectorId: 'discord',
            operation: 'install.resolve_state',
            message: 'Discord setup state is missing required fields',
            cause: decoded,
          }),
        ),
      onSome: Effect.succeed,
    })

    if (Date.now() - statePayload.issuedAt > DISCORD_SETUP_STATE_TTL_MS) {
      return yield* new ConnectorConfigError({
        connectorId: 'discord',
        operation: 'install.resolve_state',
        message: 'Discord setup state expired',
      })
    }

    return statePayload
  })
}

export function buildDiscordInstallUrl(args: {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly permissions?: string | undefined
}) {
  const url = new URL(DISCORD_AUTHORIZATION_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('scope', DISCORD_DEFAULT_INSTALL_SCOPES.join(' '))
  url.searchParams.set('permissions', args.permissions ?? DISCORD_DEFAULT_BOT_PERMISSIONS)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('integration_type', '0')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', args.state)
  return url.toString()
}

function readDiscordOAuthError(
  response: HttpClientResponse.HttpClientResponse,
  operation: string,
) {
  return response.text.pipe(
    Effect.map((text) => text.trim().slice(0, 1_000)),
    Effect.catch(() => Effect.succeed('')),
    Effect.flatMap((body) =>
      Effect.fail(
        new ConnectorHttpError({
          connectorId: 'discord',
          operation,
          message: body || `Discord returned ${response.status}`,
          status: response.status,
        }),
      ),
    ),
  )
}

function decodeTokenResponse(value: unknown) {
  const decoded = Schema.decodeUnknownOption(DiscordInstallTokenResponse)(value)
  return Option.match(decoded, {
    onNone: () =>
      Effect.fail(
        new ConnectorDecodeError({
          connectorId: 'discord',
          operation: 'install.exchange_code',
          message: 'Discord token response did not include expected install data',
          cause: value,
        }),
      ),
    onSome: Effect.succeed,
  })
}

/** Exchanges Discord's install callback code through Effect Http. */
export function exchangeDiscordInstallCode(args: {
  readonly client: HttpClient.HttpClient
  readonly config: DiscordInstallConfig
  readonly code: string
}) {
  return Effect.gen(function* () {
    const authorization = btoa(
      `${args.config.clientId}:${args.config.clientSecret}`,
    )
    const request = HttpClientRequest.make('POST')(
      new URL(`${DISCORD_API_BASE_URL}/oauth2/token`),
      {
        acceptJson: true,
        headers: {
          authorization: `Basic ${authorization}`,
        },
      },
    )

    const body = HttpBody.urlParams(
      UrlParams.fromInput({
        grant_type: 'authorization_code',
        code: args.code,
        redirect_uri: args.config.redirectUri,
      }),
    )
    const response = yield* args.client
      .execute(HttpClientRequest.setBody(request, body))
      .pipe(
        Effect.mapError(
          (cause) =>
            new ConnectorHttpError({
              connectorId: 'discord',
              operation: 'install.exchange_code',
              message: cause.message,
              cause,
            }),
        ),
      )

    if (response.status < 200 || response.status >= 300) {
      return yield* readDiscordOAuthError(response, 'install.exchange_code')
    }

    const json = yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ConnectorDecodeError({
            connectorId: 'discord',
            operation: 'install.exchange_code',
            message: 'Discord token response was not valid JSON',
            cause,
            status: response.status,
          }),
      ),
    )

    return yield* decodeTokenResponse(json)
  }).pipe(
    Effect.withSpan('connector.discord.install.exchange_code', {
      attributes: { 'connector.operation': 'install.exchange_code' },
    }),
  )
}

export function connectorErrorCode(error: ConnectorError) {
  return error._tag
}
