import { Result, TaggedError } from 'better-result'

const textEncoder = new TextEncoder()
const GITHUB_APP_JWT_BACKDATE_SECONDS = 60
const GITHUB_APP_JWT_TTL_SECONDS = 10 * 60
/** Upper bound for one GitHub App API round trip. */
const GITHUB_APP_REQUEST_TIMEOUT_MS = 15_000
/** Refresh a cached installation token this long before GitHub expires it. */
const INSTALLATION_TOKEN_REFRESH_MARGIN_MS = 5 * 60_000
/** Cached installation tokens kept per isolate before the oldest is dropped. */
const MAX_CACHED_INSTALLATION_TOKENS = 500

export class GitHubAppAuthError extends TaggedError('GitHubAppAuthError')<{
  code:
    | 'missing_config'
    | 'invalid_private_key'
    | 'jwt_sign_failed'
    | 'token_request_failed'
  message: string
  status?: number
}>() {}

type GitHubAppEnv = Record<string, string | undefined>

export type GitHubInstallationAccessToken = {
  token: string
  /** Epoch milliseconds from GitHub's `expires_at`, or null if absent. */
  expiresAt: number | null
}

/** Reads a string field from an unvalidated JSON response body. */
function stringField(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined
  const value: unknown = Reflect.get(body, key)
  return typeof value === 'string' ? value : undefined
}

function objectField(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined
  const value: unknown = Reflect.get(body, key)
  return value && typeof value === 'object' ? value : undefined
}

function parseExpiresAt(value: string | undefined) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)

  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function encodeUtf8Base64Url(value: string) {
  return base64Url(textEncoder.encode(value))
}

function decodeBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function derLength(length: number) {
  if (length < 128) return Uint8Array.of(length)

  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  }

  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

function der(tag: number, payload: Uint8Array) {
  const output = new Uint8Array(
    1 + derLength(payload.length).length + payload.length,
  )
  output[0] = tag
  output.set(derLength(payload.length), 1)
  output.set(payload, 1 + derLength(payload.length).length)
  return output
}

function concatBytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const version = der(0x02, Uint8Array.of(0x00))
  const rsaEncryptionOid = Uint8Array.of(
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
  )
  const nullParam = Uint8Array.of(0x05, 0x00)
  const algorithmIdentifier = der(
    0x30,
    concatBytes(rsaEncryptionOid, nullParam),
  )
  const privateKey = der(0x04, pkcs1)

  return der(0x30, concatBytes(version, algorithmIdentifier, privateKey))
}

function parsePrivateKeyPem(privateKey: string) {
  const trimmed = privateKey.trim()
  const unwrapped = trimmed.startsWith('"')
    ? Result.try(() => JSON.parse(trimmed) as string).unwrapOr(trimmed)
    : trimmed
  const normalized = unwrapped.replaceAll('\\n', '\n').trim()
  const match = normalized.match(
    /-----BEGIN ([^-]+)-----\s*([A-Za-z0-9+/=\s]+)\s*-----END \1-----/,
  )
  if (!match) {
    return Result.err(
      new GitHubAppAuthError({
        code: 'invalid_private_key',
        message: 'GitHub App private key is not a valid PEM block',
      }),
    )
  }

  const keyType = match[1]
  const keyData = decodeBase64(match[2]!.replace(/\s/g, ''))

  return Result.ok(
    keyType === 'RSA PRIVATE KEY' ? pkcs1ToPkcs8(keyData) : keyData,
  )
}

function requiredConfig(env: GitHubAppEnv, name: string) {
  const value = env[name]?.trim()
  if (value) return Result.ok(value)

  return Result.err(
    new GitHubAppAuthError({
      code: 'missing_config',
      message: `${name} is required`,
    }),
  )
}

export async function createGitHubAppJwt(env: GitHubAppEnv) {
  const issuer = env.GITHUB_CLIENT_ID?.trim() || env.GITHUB_APP_ID?.trim()
  if (!issuer) {
    return Result.err(
      new GitHubAppAuthError({
        code: 'missing_config',
        message: 'GITHUB_CLIENT_ID or GITHUB_APP_ID is required',
      }),
    )
  }

  const privateKeyResult = requiredConfig(env, 'GITHUB_APP_PRIVATE_KEY')
  if (privateKeyResult.isErr()) return privateKeyResult

  const keyData = parsePrivateKeyPem(privateKeyResult.value)
  if (keyData.isErr()) return keyData

  const now = Math.floor(Date.now() / 1000)
  const issuedAt = now - GITHUB_APP_JWT_BACKDATE_SECONDS
  const signingInput = [
    encodeUtf8Base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    encodeUtf8Base64Url(
      JSON.stringify({
        iat: issuedAt,
        exp: issuedAt + GITHUB_APP_JWT_TTL_SECONDS,
        iss: issuer,
      }),
    ),
  ].join('.')

  const signatureResult = await Result.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey(
        'pkcs8',
        keyData.value,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        textEncoder.encode(signingInput),
      )
      return base64Url(new Uint8Array(signature))
    },
    catch: (cause) =>
      new GitHubAppAuthError({
        code: 'jwt_sign_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to sign GitHub App JWT',
      }),
  })
  if (signatureResult.isErr()) return signatureResult

  return Result.ok(`${signingInput}.${signatureResult.value}`)
}

/**
 * Mints a fresh installation access token. Prefer
 * `getCachedGitHubInstallationAccessToken`, which reuses a token until shortly
 * before it expires instead of signing a JWT and calling GitHub every time.
 */
export async function requestGitHubInstallationAccessToken(args: {
  env: GitHubAppEnv
  installationId: string
}) {
  const jwt = await createGitHubAppJwt(args.env)
  if (jwt.isErr()) return jwt

  const responseResult = await Result.tryPromise({
    try: async (): Promise<GitHubInstallationAccessToken> => {
      const response = await fetch(
        `https://api.github.com/app/installations/${args.installationId}/access_tokens`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${jwt.value}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'garden-github-app',
          },
          signal: AbortSignal.timeout(GITHUB_APP_REQUEST_TIMEOUT_MS),
        },
      )
      const body: unknown = await response.json()
      const token = stringField(body, 'token')

      if (!response.ok || !token) {
        throw new GitHubAppAuthError({
          code: 'token_request_failed',
          status: response.status,
          message:
            stringField(body, 'message') ??
            `Failed to create GitHub installation token (${response.status})`,
        })
      }

      return {
        token,
        expiresAt: parseExpiresAt(stringField(body, 'expires_at')),
      }
    },
    catch: (cause) =>
      cause instanceof GitHubAppAuthError
        ? cause
        : new GitHubAppAuthError({
            code: 'token_request_failed',
            message:
              cause instanceof Error
                ? cause.message
                : 'Failed to create GitHub installation token',
          }),
  })

  return responseResult
}

/** Mints a fresh installation access token and returns only the token. */
export async function createGitHubInstallationAccessToken(args: {
  env: GitHubAppEnv
  installationId: string
}) {
  const result = await requestGitHubInstallationAccessToken(args)
  if (result.isErr()) return result
  return Result.ok(result.value.token)
}

const installationTokenCache = new Map<string, GitHubInstallationAccessToken>()
const installationTokenRequests = new Map<
  string,
  ReturnType<typeof requestGitHubInstallationAccessToken>
>()

function installationTokenCacheKey(args: {
  env: GitHubAppEnv
  installationId: string
}) {
  const issuer =
    args.env.GITHUB_CLIENT_ID?.trim() || args.env.GITHUB_APP_ID?.trim() || ''
  return `${issuer}:${args.installationId}`
}

/**
 * Returns an installation access token, reusing the one cached for this app
 * and installation until `INSTALLATION_TOKEN_REFRESH_MARGIN_MS` before it
 * expires. GitHub installation tokens live for an hour; minting one per API
 * call cost a JWT signature plus an extra round trip on every request and
 * counted against the app's rate limit. Concurrent callers share one request.
 */
export async function getCachedGitHubInstallationAccessToken(args: {
  env: GitHubAppEnv
  installationId: string
  now?: () => number
}) {
  const now = args.now ?? Date.now
  const key = installationTokenCacheKey(args)
  const cached = installationTokenCache.get(key)
  if (
    cached?.expiresAt != null &&
    cached.expiresAt - INSTALLATION_TOKEN_REFRESH_MARGIN_MS > now()
  ) {
    return Result.ok(cached.token)
  }

  let request = installationTokenRequests.get(key)
  if (!request) {
    request = requestGitHubInstallationAccessToken(args)
    installationTokenRequests.set(key, request)
  }
  const result = await request.finally(() => {
    if (installationTokenRequests.get(key) === request) {
      installationTokenRequests.delete(key)
    }
  })
  if (result.isErr()) return result

  installationTokenCache.delete(key)
  if (result.value.expiresAt !== null) {
    if (installationTokenCache.size >= MAX_CACHED_INSTALLATION_TOKENS) {
      const oldest = installationTokenCache.keys().next()
      if (!oldest.done) installationTokenCache.delete(oldest.value)
    }
    installationTokenCache.set(key, result.value)
  }
  return Result.ok(result.value.token)
}

/**
 * Drops a cached installation token, e.g. after GitHub rejects it with 401
 * because the installation was suspended or its permissions changed.
 */
export function invalidateCachedGitHubInstallationAccessToken(args: {
  env: GitHubAppEnv
  installationId: string
}) {
  installationTokenCache.delete(installationTokenCacheKey(args))
}

/**
 * Uninstalls Garden's GitHub App instead of only hiding the installation
 * locally. GitHub documents DELETE /app/installations/{installation_id} for
 * authenticated apps; a missing installation is already disconnected.
 */
export async function deleteGitHubAppInstallation(args: {
  env: GitHubAppEnv
  installationId: string
  fetch?: typeof fetch
}) {
  const jwt = await createGitHubAppJwt(args.env)
  if (jwt.isErr()) return jwt

  return await Result.tryPromise({
    try: async () => {
      const response = await (args.fetch ?? fetch)(
        `https://api.github.com/app/installations/${args.installationId}`,
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${jwt.value}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'garden-github-app',
          },
          signal: AbortSignal.timeout(GITHUB_APP_REQUEST_TIMEOUT_MS),
        },
      )
      if (response.ok || response.status === 404) return

      const body: unknown = await response.json()
      throw new GitHubAppAuthError({
        code: 'token_request_failed',
        status: response.status,
        message:
          stringField(body, 'message') ??
          `Failed to delete GitHub installation (${response.status})`,
      })
    },
    catch: (cause) =>
      cause instanceof GitHubAppAuthError
        ? cause
        : new GitHubAppAuthError({
            code: 'token_request_failed',
            message:
              cause instanceof Error
                ? cause.message
                : 'Failed to delete GitHub installation',
          }),
  })
}

export async function getGitHubAppInstallation(args: {
  env: GitHubAppEnv
  installationId: string
}) {
  const jwt = await createGitHubAppJwt(args.env)
  if (jwt.isErr()) return jwt

  const installationResult = await Result.tryPromise({
    try: async () => {
      const response = await fetch(
        `https://api.github.com/app/installations/${args.installationId}`,
        {
          headers: {
            authorization: `Bearer ${jwt.value}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'garden-github-app',
          },
          signal: AbortSignal.timeout(GITHUB_APP_REQUEST_TIMEOUT_MS),
        },
      )
      const body: unknown = await response.json()

      if (!response.ok) {
        throw new GitHubAppAuthError({
          code: 'token_request_failed',
          status: response.status,
          message:
            stringField(body, 'message') ??
            `Failed to load GitHub installation (${response.status})`,
        })
      }

      const account = objectField(body, 'account')
      const installation: {
        account?: { login?: string }
        repository_selection?: string
        target_type?: string
        message?: string
      } = {
        ...(account
          ? { account: { login: stringField(account, 'login') } }
          : {}),
        repository_selection: stringField(body, 'repository_selection'),
        target_type: stringField(body, 'target_type'),
        message: stringField(body, 'message'),
      }
      return installation
    },
    catch: (cause) =>
      cause instanceof GitHubAppAuthError
        ? cause
        : new GitHubAppAuthError({
            code: 'token_request_failed',
            message:
              cause instanceof Error
                ? cause.message
                : 'Failed to load GitHub installation',
          }),
  })

  return installationResult
}
