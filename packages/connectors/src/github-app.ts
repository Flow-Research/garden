import { Result, TaggedError } from 'better-result'

const textEncoder = new TextEncoder()
const GITHUB_APP_JWT_BACKDATE_SECONDS = 60
const GITHUB_APP_JWT_TTL_SECONDS = 10 * 60

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

export async function createGitHubInstallationAccessToken(args: {
  env: GitHubAppEnv
  installationId: string
}) {
  const jwt = await createGitHubAppJwt(args.env)
  if (jwt.isErr()) return jwt

  const responseResult = await Result.tryPromise({
    try: async () => {
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
        },
      )
      const body = (await response.json()) as {
        token?: string
        message?: string
      }

      if (!response.ok || !body.token) {
        throw new GitHubAppAuthError({
          code: 'token_request_failed',
          status: response.status,
          message:
            body.message ??
            `Failed to create GitHub installation token (${response.status})`,
        })
      }

      return body.token
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
        },
      )
      if (response.ok || response.status === 404) return

      const body = (await response.json()) as { message?: string }
      throw new GitHubAppAuthError({
        code: 'token_request_failed',
        status: response.status,
        message:
          body.message ??
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
        },
      )
      const body = (await response.json()) as {
        account?: { login?: string }
        repository_selection?: string
        target_type?: string
        message?: string
      }

      if (!response.ok) {
        throw new GitHubAppAuthError({
          code: 'token_request_failed',
          status: response.status,
          message:
            body.message ??
            `Failed to load GitHub installation (${response.status})`,
        })
      }

      return body
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
