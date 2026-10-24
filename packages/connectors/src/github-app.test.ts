import { describe, expect, it, vi } from 'vitest'
import {
  createGitHubAppJwt,
  createGitHubInstallationAccessToken,
  deleteGitHubAppInstallation,
  normalizeGitHubAppPrivateKey,
} from './github-app'

describe('normalizeGitHubAppPrivateKey', () => {
  it('unwraps JSON-quoted PEMs and literal \\n escapes', () => {
    expect(
      normalizeGitHubAppPrivateKey(
        '"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----"',
      ),
    ).toBe('-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----')
  })

  it('returns undefined for empty input', () => {
    expect(normalizeGitHubAppPrivateKey(undefined)).toBeUndefined()
    expect(normalizeGitHubAppPrivateKey('   ')).toBeUndefined()
  })
})


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

describe('createGitHubInstallationAccessToken', () => {
  it('returns token, expiresAt, and installationId from GitHub', async () => {
    const request = vi.fn(
      async () =>
        Response.json({
          token: 'ghs_test_token',
          expires_at: '2026-10-22T12:00:00Z',
        }),
    )
    const result = await createGitHubInstallationAccessToken({
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '98765',
      fetch: request,
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error
    expect(result.value).toEqual({
      token: 'ghs_test_token',
      expiresAt: '2026-10-22T12:00:00Z',
      installationId: '98765',
    })
    expect(request).toHaveBeenCalledWith(
      'https://api.github.com/app/installations/98765/access_tokens',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    )
  })

  it('fails when installation id is missing', async () => {
    const result = await createGitHubInstallationAccessToken({
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '   ',
      fetch: vi.fn(),
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) throw new Error('expected missing installation id')
    expect(result.error).toMatchObject({
      code: 'missing_config',
      message: 'GitHub installation id is required',
    })
  })

  it('maps GitHub token mint failures', async () => {
    const request = vi.fn(
      async () =>
        Response.json({ message: 'Bad credentials' }, { status: 401 }),
    )
    const result = await createGitHubInstallationAccessToken({
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: await createPrivateKeyPem(),
      },
      installationId: '98765',
      fetch: request,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) throw new Error('expected mint failure')
    expect(result.error).toMatchObject({
      code: 'token_request_failed',
      status: 401,
      message: 'Bad credentials',
    })
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
