import { describe, expect, it, vi } from 'vitest'
import { createGitHubAppJwt, deleteGitHubAppInstallation } from './github-app'

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
