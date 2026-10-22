import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { Result } from 'better-result'
import { ConnectorAuthError } from '../effect/errors.ts'
import { createGitHubInstallationAccessToken } from '../github-app.ts'
import { GitHubRestClient, makeGitHubBaseLayer } from './rest-client.ts'

vi.mock('../github-app.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../github-app.ts')>()
  return {
    ...actual,
    createGitHubInstallationAccessToken: vi.fn(),
  }
})

const mint = vi.mocked(createGitHubInstallationAccessToken)

function mintOk(token: string) {
  mint.mockResolvedValueOnce(
    Result.ok({
      token,
      expiresAt: '2026-10-22T12:00:00Z',
      installationId: '42',
    }),
  )
}

describe('GitHubRestClient remint-once', () => {
  beforeEach(() => {
    mint.mockReset()
  })

  it('remints once after HTTP 401 and succeeds on the retry', async () => {
    mintOk('ghs_stale')
    mintOk('ghs_fresh')

    const seenAuth: string[] = []
    const fetch: typeof globalThis.fetch = (async (_input, init) => {
      const authorization = new Headers(init?.headers).get('authorization')
      seenAuth.push(authorization ?? '')
      if (authorization === 'Bearer ghs_stale') {
        return new Response('Bad credentials', { status: 401 })
      }
      return new Response(JSON.stringify({ id: 1, title: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* GitHubRestClient
        return yield* client.request({
          operation: 'github.getIssue',
          path: '/repos/acme/garden/issues/1',
        })
      }).pipe(
        Effect.provide(
          makeGitHubBaseLayer(
            { installationId: '42', appId: '1', privateKey: 'pem' },
            { fetch },
          ),
        ),
      ),
    )

    expect(result).toEqual({ id: 1, title: 'ok' })
    expect(mint).toHaveBeenCalledTimes(2)
    expect(seenAuth).toEqual(['Bearer ghs_stale', 'Bearer ghs_fresh'])
  })

  it('surfaces token_rejected after remint still gets 401', async () => {
    mintOk('ghs_a')
    mintOk('ghs_b')

    const fetch: typeof globalThis.fetch = (async () =>
      new Response('Bad credentials', { status: 401 })) as typeof globalThis.fetch

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* GitHubRestClient
        return yield* client.request({
          operation: 'github.getIssue',
          path: '/repos/acme/garden/issues/1',
        })
      }).pipe(
        Effect.provide(
          makeGitHubBaseLayer(
            { installationId: '42', appId: '1', privateKey: 'pem' },
            { fetch },
          ),
        ),
        Effect.flip,
      ),
    )

    expect(error).toBeInstanceOf(ConnectorAuthError)
    expect(error).toMatchObject({
      code: 'github.token_rejected',
      operation: 'github.getIssue',
      status: 401,
    })
    expect(error.message).toMatch(/\[github\.token_rejected\]/)
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('does not remint on 403 insufficient_permission', async () => {
    mintOk('ghs_ok')

    const fetch: typeof globalThis.fetch = (async () =>
      new Response('Resource not accessible by integration', {
        status: 403,
      })) as typeof globalThis.fetch

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* GitHubRestClient
        return yield* client.request({
          operation: 'github.getIssue',
          path: '/repos/acme/garden/issues/1',
        })
      }).pipe(
        Effect.provide(
          makeGitHubBaseLayer(
            { installationId: '42', appId: '1', privateKey: 'pem' },
            { fetch },
          ),
        ),
        Effect.flip,
      ),
    )

    expect(error).toMatchObject({
      code: 'github.insufficient_permission',
      status: 403,
    })
    expect(mint).toHaveBeenCalledTimes(1)
  })
})
