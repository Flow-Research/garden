import { describe, expect, it, vi } from 'vitest'
import { revokeOAuthConnector } from './connector-revocation'

describe('revokeOAuthConnector', () => {
  it('revokes Google access with the refresh token before local deletion', async () => {
    const request = vi.fn(async () => new Response(null, { status: 200 }))

    const result = await revokeOAuthConnector({
      connectorId: 'gmail',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      fetch: request,
    })

    expect(result.isOk()).toBe(true)
    expect(request).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({
        method: 'POST',
        body: new URLSearchParams({ token: 'refresh-token' }),
      }),
    )
  })

  it('revokes Slack access with bearer authentication', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, revoked: true }), {
          status: 200,
        }),
    )

    const result = await revokeOAuthConnector({
      connectorId: 'slack',
      accessToken: 'slack-token',
      refreshToken: 'slack-refresh-token',
      fetch: request,
    })

    expect(result.isOk()).toBe(true)
    expect(request).toHaveBeenCalledWith(
      'https://slack.com/api/auth.revoke',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer slack-token',
        }),
      }),
    )
  })

  it('treats already-revoked provider tokens as disconnected', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'token_revoked' }), {
          status: 200,
        }),
    )

    const result = await revokeOAuthConnector({
      connectorId: 'slack',
      accessToken: 'dead-token',
      refreshToken: null,
      fetch: request,
    })

    expect(result.isOk()).toBe(true)
  })

  it('preserves local credentials when the provider rejects revocation', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
          status: 503,
        }),
    )

    const result = await revokeOAuthConnector({
      connectorId: 'google-drive',
      accessToken: 'access-token',
      refreshToken: null,
      fetch: request,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('provider_rejected')
  })

  it('is idempotent when Garden no longer has a token', async () => {
    const request = vi.fn()
    const result = await revokeOAuthConnector({
      connectorId: 'gmail',
      accessToken: null,
      refreshToken: null,
      fetch: request,
    })

    expect(result.isOk()).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
})
