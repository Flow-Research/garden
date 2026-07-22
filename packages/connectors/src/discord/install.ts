import { Effect, Schema } from 'effect'
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  UrlParams,
} from 'effect/unstable/http'
import { DiscordGuild } from './schemas.ts'

const DISCORD_AUTHORIZATION_URL = 'https://discord.com/oauth2/authorize'
const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token'
const DISCORD_SETUP_STATE_TTL_MS = 15 * 60 * 1_000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const DISCORD_DEFAULT_INSTALL_SCOPES = [
  'bot',
  'applications.commands',
  'identify',
] as const

export const DISCORD_DEFAULT_BOT_PERMISSIONS = String(
  64n +
    1024n +
    2048n +
    65_536n +
    34_359_738_368n +
    68_719_476_736n +
    274_877_906_944n,
)

const DiscordSetupStatePayload = Schema.Struct({
  userId: Schema.String,
  workspaceId: Schema.String,
  issuedAt: Schema.Number,
})
export type DiscordSetupStatePayload = typeof DiscordSetupStatePayload.Type

const DiscordInstallTokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optional(Schema.String),
  scope: Schema.String,
  guild: Schema.optional(DiscordGuild),
})
export type DiscordInstallTokenResponse =
  typeof DiscordInstallTokenResponse.Type

export const DiscordInstallConfig = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.String,
  botToken: Schema.String,
  redirectUri: Schema.String,
  permissions: Schema.String,
})
export type DiscordInstallConfig = typeof DiscordInstallConfig.Type

export class DiscordInstallConfigError extends Schema.ErrorClass<DiscordInstallConfigError>(
  'DiscordInstallConfigError',
)({
  kind: Schema.Literal('config'),
  operation: Schema.String,
  message: Schema.String,
}) {}

export class DiscordInstallStateError extends Schema.ErrorClass<DiscordInstallStateError>(
  'DiscordInstallStateError',
)({
  kind: Schema.Literal('state'),
  operation: Schema.String,
  message: Schema.String,
}) {}

export class DiscordInstallHttpError extends Schema.ErrorClass<DiscordInstallHttpError>(
  'DiscordInstallHttpError',
)({
  kind: Schema.Literal('http'),
  operation: Schema.String,
  message: Schema.String,
  status: Schema.NullOr(Schema.Number),
}) {}

export class DiscordInstallDecodeError extends Schema.ErrorClass<DiscordInstallDecodeError>(
  'DiscordInstallDecodeError',
)({
  kind: Schema.Literal('decode'),
  operation: Schema.String,
  message: Schema.String,
}) {}

export type DiscordInstallError =
  | DiscordInstallConfigError
  | DiscordInstallStateError
  | DiscordInstallHttpError
  | DiscordInstallDecodeError

/** Validates the Garden-owned Discord application configuration. */
export const requireDiscordInstallConfig = Effect.fn(
  'DiscordInstall.requireConfig',
)(function* (input: {
  readonly clientId?: string
  readonly clientSecret?: string
  readonly botToken?: string
  readonly redirectUri: string
  readonly permissions?: string
}) {
  const clientId = input.clientId?.trim()
  const clientSecret = input.clientSecret?.trim()
  const botToken = input.botToken?.trim()
  const redirectUri = input.redirectUri.trim()
  if (!clientId || !clientSecret || !botToken || !redirectUri) {
    return yield* new DiscordInstallConfigError({
      kind: 'config',
      operation: 'configure',
      message: 'Garden Discord application configuration is incomplete.',
    })
  }
  return DiscordInstallConfig.make({
    clientId,
    clientSecret,
    botToken,
    redirectUri,
    permissions: input.permissions?.trim() || DISCORD_DEFAULT_BOT_PERMISSIONS,
  })
})

const base64Url = (bytes: Uint8Array): string => {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const decodeBase64Url = (value: string): Uint8Array => {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const signSetupState = Effect.fn('DiscordInstall.signState')(function* (
  secret: string,
  payload: string,
) {
  return yield* Effect.tryPromise({
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
    catch: () =>
      new DiscordInstallStateError({
        kind: 'state',
        operation: 'sign',
        message: 'Discord install state could not be signed.',
      }),
  })
})

const constantTimeEquals = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

/** Creates short-lived signed state binding a Discord install to one member and workspace. */
export const createDiscordSetupState = Effect.fn('DiscordInstall.createState')(
  function* (input: {
    readonly secret: string
    readonly userId: string
    readonly workspaceId: string
  }) {
    const payload = base64Url(
      textEncoder.encode(
        JSON.stringify({
          userId: input.userId,
          workspaceId: input.workspaceId,
          issuedAt: Date.now(),
        }),
      ),
    )
    const signature = yield* signSetupState(input.secret, payload)
    return `${payload}.${signature}`
  },
)

/** Verifies and decodes Discord callback state before any installation write. */
export const resolveDiscordSetupState = Effect.fn(
  'DiscordInstall.resolveState',
)(function* (input: { readonly secret: string; readonly state: string }) {
  const separator = input.state.indexOf('.')
  if (separator < 1) {
    return yield* new DiscordInstallStateError({
      kind: 'state',
      operation: 'resolve',
      message: 'Discord install state is invalid.',
    })
  }
  const payload = input.state.slice(0, separator)
  const signature = input.state.slice(separator + 1)
  const expected = yield* signSetupState(input.secret, payload)
  if (!constantTimeEquals(expected, signature)) {
    return yield* new DiscordInstallStateError({
      kind: 'state',
      operation: 'resolve',
      message: 'Discord install state signature is invalid.',
    })
  }

  const json = yield* Effect.try({
    try: () => textDecoder.decode(decodeBase64Url(payload)),
    catch: () =>
      new DiscordInstallDecodeError({
        kind: 'decode',
        operation: 'resolve_state',
        message: 'Discord install state could not be decoded.',
      }),
  })
  const state = yield* Effect.mapError(
    Schema.decodeUnknownEffect(Schema.fromJsonString(DiscordSetupStatePayload))(
      json,
    ),
    () =>
      new DiscordInstallDecodeError({
        kind: 'decode',
        operation: 'resolve_state',
        message: 'Discord install state has an invalid shape.',
      }),
  )
  if (Date.now() - state.issuedAt > DISCORD_SETUP_STATE_TTL_MS) {
    return yield* new DiscordInstallStateError({
      kind: 'state',
      operation: 'resolve',
      message: 'Discord install state expired.',
    })
  }
  return state
})

/** Builds Discord's advanced bot authorization URL for Garden's shared application. */
export const buildDiscordInstallUrl = (input: {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly permissions: string
}): string => {
  const url = new URL(DISCORD_AUTHORIZATION_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('scope', DISCORD_DEFAULT_INSTALL_SCOPES.join(' '))
  url.searchParams.set('permissions', input.permissions)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('integration_type', '0')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', input.state)
  return url.toString()
}

/** Exchanges Discord's callback code through Effect Http and decodes guild install data. */
export const exchangeDiscordInstallCode = Effect.fn(
  'DiscordInstall.exchangeCode',
)(function* (config: DiscordInstallConfig, code: string) {
  const client = yield* HttpClient.HttpClient
  const authorization = btoa(`${config.clientId}:${config.clientSecret}`)
  let request = HttpClientRequest.post(DISCORD_TOKEN_URL)
  request = HttpClientRequest.setHeaders(request, {
    accept: 'application/json',
    authorization: `Basic ${authorization}`,
  })
  request = HttpClientRequest.setBody(
    request,
    HttpBody.urlParams(
      UrlParams.fromInput({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
      }),
    ),
  )

  const response = yield* Effect.mapError(
    client.execute(request),
    () =>
      new DiscordInstallHttpError({
        kind: 'http',
        operation: 'exchange_code',
        message: 'Discord token exchange failed.',
        status: null,
      }),
  )
  if (response.status < 200 || response.status >= 300) {
    return yield* new DiscordInstallHttpError({
      kind: 'http',
      operation: 'exchange_code',
      message: 'Discord rejected the installation callback.',
      status: response.status,
    })
  }
  const json = yield* Effect.mapError(
    response.json,
    () =>
      new DiscordInstallDecodeError({
        kind: 'decode',
        operation: 'exchange_code',
        message: 'Discord token response was not valid JSON.',
      }),
  )
  return yield* Effect.mapError(
    Schema.decodeUnknownEffect(DiscordInstallTokenResponse)(json),
    () =>
      new DiscordInstallDecodeError({
        kind: 'decode',
        operation: 'exchange_code',
        message: 'Discord token response did not include installation data.',
      }),
  )
})
