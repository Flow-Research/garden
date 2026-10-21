import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGitHubAppJwt,
  deleteGitHubAppInstallation,
  getCachedGitHubInstallationAccessToken,
  invalidateCachedGitHubInstallationAccessToken,
} from './github-app'

function base64UrlJson(segment: string) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as {
    iat: number
    exp: number
    iss: string
  }
}

function pemFromPkcs8(keyData: ArrayBuffer) {
  const body = Buffer.from(keyData)
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')

  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
}

async function createPrivateKeyPem() {
  const key = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key.privateKey)
  return pemFromPkcs8(pkcs8)
}

describe('createGitHubAppJwt', () => {
  it('keeps exp no more than ten minutes after iat', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-14T01:00:00.000Z'))
    const token = await createGitHubAppJwt({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
    })

    expect(token.isOk()).toBe(true)
    if (token.isErr()) throw token.error

    const payload = base64UrlJson(token.value.split('.')[1]!)
    expect(payload).toMatchObject({
      iss: '12345',
      iat: 1778720340,
      exp: 1778720940,
    })
    expect(payload.exp - payload.iat).toBe(600)

    vi.useRealTimers()
  })
})

describe('deleteGitHubAppInstallation', () => {
  it('uninstalls through the authenticated app endpoint', async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }))
    const result = await deleteGitHubAppInstallation({
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '98765',
      fetch: request,
    })

    expect(result.isOk()).toBe(true)
    expect(request).toHaveBeenCalledWith(
      'https://api.github.com/app/installations/98765',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    )
  })

  it('treats an already-missing installation as disconnected', async () => {
    const request = vi.fn(async () => new Response(null, { status: 404 }))
    const result = await deleteGitHubAppInstallation({
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '98765',
      fetch: request,
    })

    expect(result.isOk()).toBe(true)
  })
})

describe('getCachedGitHubInstallationAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubTokenEndpoint(expiresAt: () => string | undefined) {
    let minted = 0
    const fetchMock = vi.fn(async () => {
      minted += 1
      const expires = expiresAt()
      return Response.json(
        {
          token: `token-${minted}`,
          ...(expires ? { expires_at: expires } : {}),
        },
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('reuses a token until shortly before it expires', async () => {
    const fetchMock = stubTokenEndpoint(() => '2026-05-14T02:00:00.000Z')
    const args = {
      env: {
        GITHUB_APP_ID: 'cache-app-1',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '111',
    }
    let now = Date.parse('2026-05-14T01:00:00.000Z')
    const clock = () => now

    const first = await getCachedGitHubInstallationAccessToken({
      ...args,
      now: clock,
    })
    const second = await getCachedGitHubInstallationAccessToken({
      ...args,
      now: clock,
    })
    expect(first.isOk() && first.value).toBe('token-1')
    expect(second.isOk() && second.value).toBe('token-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Within the refresh margin of expiry a new token is minted.
    now = Date.parse('2026-05-14T01:56:00.000Z')
    const refreshed = await getCachedGitHubInstallationAccessToken({
      ...args,
      now: clock,
    })
    expect(refreshed.isOk() && refreshed.value).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares one request between concurrent callers', async () => {
    const fetchMock = stubTokenEndpoint(() => '2999-01-01T00:00:00.000Z')
    const args = {
      env: {
        GITHUB_APP_ID: 'cache-app-2',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '222',
    }

    const [first, second] = await Promise.all([
      getCachedGitHubInstallationAccessToken(args),
      getCachedGitHubInstallationAccessToken(args),
    ])
    expect(first.isOk() && first.value).toBe('token-1')
    expect(second.isOk() && second.value).toBe('token-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('mints again after invalidation or without an expiry', async () => {
    const fetchMock = stubTokenEndpoint(() => undefined)
    const args = {
      env: {
        GITHUB_APP_ID: 'cache-app-3',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '333',
    }

    await getCachedGitHubInstallationAccessToken(args)
    await getCachedGitHubInstallationAccessToken(args)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    invalidateCachedGitHubInstallationAccessToken(args)
    await getCachedGitHubInstallationAccessToken(args)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
