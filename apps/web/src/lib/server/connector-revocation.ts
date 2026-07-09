import { Result, TaggedError } from 'better-result'

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

function responseMessage(body: ProviderResponse, fallback: string) {
  return body.error_description ?? body.error ?? fallback
}

async function readProviderResponse(response: Response) {
  const text = await response.text()
  if (!text) return {} satisfies ProviderResponse
  return Result.try(() => JSON.parse(text) as ProviderResponse).unwrapOr({})
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
    const token = args.accessToken
    if (!token) return Result.ok(undefined)
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
        const inaccessibleErrors = new Set([
          'account_inactive',
          'invalid_auth',
          'token_expired',
          'token_revoked',
        ])
        if (
          (response.ok && body.ok === true) ||
          (body.error && inaccessibleErrors.has(body.error))
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
    return result.isErr() ? result : Result.ok(undefined)
  }

  return Result.err(
    new ConnectorRevocationError({
      code: 'unsupported_connector',
      message: `Connector ${args.connectorId} does not define OAuth revocation`,
    }),
  )
}
