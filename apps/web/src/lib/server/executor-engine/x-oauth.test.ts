import { Effect } from 'effect'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
  OAuthClientSlug,
  Subject,
  Tenant,
  createExecutor,
} from '@executor-js/sdk/core'
import { encryptedSecretsPlugin } from '@executor-js/plugin-encrypted-secrets'
import { xResearchPlugin } from './x-research'
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { makeXOAuthFetch, X_TOKEN_URL, X_AUTHORIZATION_URL } from './x-oauth'

describe('X OAuth transport', () => {
  it.each(['authorization_code', 'refresh_token'])(
    'uses confidential Basic authentication for %s without changing PKCE or refresh data',
    async (grant) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response('{}'))
      const body = new URLSearchParams({
        client_id: 'client:id',
        client_secret: 'secret+value',
        grant_type: grant,
        code_verifier: 'pkce',
        refresh_token: 'refresh',
      })
      await makeXOAuthFetch(fetch)(X_TOKEN_URL, { method: 'POST', body })
      const request = fetch.mock.calls[0][0] as Request
      expect(request.headers.get('authorization')).toBe(
        `Basic ${btoa('client%3Aid:secret%2Bvalue')}`,
      )
      expect(request.redirect).toBe('error')
      const form = new URLSearchParams(await request.text())
      expect(form.has('client_secret')).toBe(false)
      expect(form.get('grant_type')).toBe(grant)
      expect(form.get('code_verifier')).toBe('pkce')
      expect(form.get('refresh_token')).toBe('refresh')
    },
  )
  it('preserves every other provider request unchanged', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{}'))
    const init = { method: 'POST', body: 'client_secret=google-secret' }
    await makeXOAuthFetch(fetch)('https://oauth2.googleapis.com/token', init)
    expect(fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      init,
    )
  })
  it('SDK completes PKCE once and coalesces concurrent expired-token refreshes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        Response.json({
          access_token: fetch.mock.calls.length === 1 ? 'expired' : 'refreshed',
          refresh_token: 'rotated-refresh',
          expires_in: fetch.mock.calls.length === 1 ? 0 : 3600,
          token_type: 'bearer',
          scope: 'tweet.read users.read offline.access',
        }),
      )
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* Effect.acquireRelease(
            createExecutor({
              tenant: Tenant.make('workspace'),
              subject: Subject.make('person'),
              plugins: [
                xResearchPlugin(),
                encryptedSecretsPlugin({
                  key: 'test-secret-key-at-least-32-characters',
                }),
              ] as const,
              fetch: makeXOAuthFetch(fetch),
            }),
            (executor) => executor.close().pipe(Effect.ignore),
          )
          yield* executor.xResearch.install()
          const client = yield* executor.oauth.createClient({
            owner: 'org',
            slug: OAuthClientSlug.make('garden-x'),
            authorizationUrl: X_AUTHORIZATION_URL,
            tokenUrl: X_TOKEN_URL,
            grant: 'authorization_code',
            clientId: 'client',
            clientSecret: 'secret',
          })
          const start = yield* executor.oauth.start({
            client,
            clientOwner: 'org',
            owner: 'user',
            integration: IntegrationSlug.make('x-research'),
            name: ConnectionName.make('personal'),
            template: AuthTemplateSlug.make('x-read'),
            redirectUri: 'http://localhost:3000/api/oauth/callback',
          })
          expect(start.status).toBe('redirect')
          if (start.status !== 'redirect') return
          const authorize = new URL(start.authorizationUrl)
          expect(authorize.searchParams.get('code_challenge_method')).toBe(
            'S256',
          )
          expect(authorize.searchParams.get('scope')).not.toContain(
            'bookmark.read',
          )
          const connection = yield* executor.oauth.complete({
            state: start.state,
            code: 'test-code',
          })
          expect(connection.owner).toBe('user')
          const tools = yield* executor.tools.list()
          const feed = tools.find(
            (tool) => String(tool.name) === 'x_read_feed',
          )!
          const results = yield* Effect.all(
            [
              executor.execute(feed.address, { limit: 1 }).pipe(Effect.result),
              executor.execute(feed.address, { limit: 1 }).pipe(Effect.result),
            ],
            { concurrency: 'unbounded' },
          )
          expect(results.every((result) => result._tag === 'Failure')).toBe(
            true,
          )
          expect(fetch).toHaveBeenCalledTimes(2)
          const refreshRequest = fetch.mock.calls[1][0] as Request
          expect(refreshRequest.headers.get('authorization')).toBe(
            `Basic ${btoa('client:secret')}`,
          )
          const body = yield* Effect.promise(() =>
            refreshRequest.clone().text(),
          )
          expect(new URLSearchParams(body).get('grant_type')).toBe(
            'refresh_token',
          )
          const replay = yield* executor.oauth
            .complete({ state: start.state, code: 'test-code' })
            .pipe(Effect.result)
          expect(replay).toMatchObject({ _tag: 'Failure' })
        }),
      ),
    )
  })
})
