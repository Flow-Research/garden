import { Result, TaggedError } from 'better-result'
import { decryptOAuthToken } from 'better-auth/oauth2'
import type { SecretConfig } from 'better-auth/crypto'

export class ConnectorRevocationError extends TaggedError(
  'ConnectorRevocationError',
)<{
  code: 'provider_rejected' | 'request_failed' | 'unsupported_connector'
  message: string
}>() {}

type ProviderResponse = {
  error?: string
  error_description?: string
  ok?: boolean
  revoked?: boolean
}

export type OAuthDecryptContext = {
  options: { account?: { encryptOAuthTokens?: boolean } }
  secretConfig: string | SecretConfig
}

function responseMessage(body: ProviderResponse, fallback: string) {
  return body.error_description ?? body.error ?? fallback
}

async function readProviderResponse(response: Response) {
  const text = await response.text()
  if (!text) return {} satisfies ProviderResponse
  return Result.try(() => JSON.parse(text) as ProviderResponse).unwrapOr({})
}

/**
 * Decrypts Better Auth OAuth columns at the auth boundary. Production enables
 * encryptOAuthTokens, so direct database values are ciphertext and must never
 * be sent to providers. Better Auth's public OAuth utility also leaves legacy
 * plaintext values unchanged, keeping local/test data compatible.
 */
export async function decryptStoredOAuthTokens(args: {
  accessToken: string | null
  refreshToken: string | null
  context: OAuthDecryptContext
}) {
  const context = args.context as Parameters<typeof decryptOAuthToken>[1]
  return {
    accessToken: args.accessToken
      ? await decryptOAuthToken(args.accessToken, context)
      : null,
    refreshToken: args.refreshToken
      ? await decryptOAuthToken(args.refreshToken, context)
      : null,
  }
}

/**
 * Revokes Google or Slack OAuth access before Garden erases its only token copy.
 * Previously disconnect only nulled local columns, leaving provider-issued
 * credentials valid. Google OAuth revocation and Slack auth.revoke are the
 * provider-documented removal endpoints; already-dead tokens are idempotent.
 */
export async function revokeOAuthConnector(args: {
  connectorId: string
  accessToken: string | null
  refreshToken: string | null
  fetch?: typeof fetch
}) {
  const request = args.fetch ?? fetch

  if (args.connectorId === 'gmail' || args.connectorId === 'google-drive') {
    const token = args.refreshToken ?? args.accessToken
    if (!token) return Result.ok(undefined)
    const result = await Result.tryPromise({
      try: async () => {
        const response = await request('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        })
        const body = await readProviderResponse(response)
        if (response.ok || body.error === 'invalid_token') return
        throw new ConnectorRevocationError({
          code: 'provider_rejected',
          message: responseMessage(
            body,
            `Google rejected token revocation (${response.status})`,
          ),
        })
      },
      catch: (cause) =>
        cause instanceof ConnectorRevocationError
          ? cause
          : new ConnectorRevocationError({
              code: 'request_failed',
              message:
                cause instanceof Error
                  ? cause.message
                  : 'Google token revocation failed',
            }),
    })
    return result.isErr() ? result : Result.ok(undefined)
  }

  if (args.connectorId === 'slack') {
    const tokens = [...new Set([args.refreshToken, args.accessToken])].filter(
      (token): token is string => Boolean(token),
    )
    if (tokens.length === 0) return Result.ok(undefined)

    for (const token of tokens) {
      const result = await Result.tryPromise({
        try: async () => {
          const response = await request('https://slack.com/api/auth.revoke', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
          })
          const body = await readProviderResponse(response)
          const terminalErrors = new Set([
            'account_inactive',
            'token_expired',
            'token_revoked',
          ])
          if (
            (response.ok && body.ok === true && body.revoked === true) ||
            (body.error && terminalErrors.has(body.error))
          ) {
            return
          }
          throw new ConnectorRevocationError({
            code: 'provider_rejected',
            message: responseMessage(
              body,
              `Slack rejected token revocation (${response.status})`,
            ),
          })
        },
        catch: (cause) =>
          cause instanceof ConnectorRevocationError
            ? cause
            : new ConnectorRevocationError({
                code: 'request_failed',
                message:
                  cause instanceof Error
                    ? cause.message
                    : 'Slack token revocation failed',
              }),
      })
      if (result.isErr()) return result
    }

    return Result.ok(undefined)
  }

  return Result.err(
    new ConnectorRevocationError({
      code: 'unsupported_connector',
      message: `Connector ${args.connectorId} does not define OAuth revocation`,
    }),
  )
}
