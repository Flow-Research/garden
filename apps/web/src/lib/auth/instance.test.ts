import { describe, expect, it } from 'vitest'
import type { Db } from '@/lib/server/db'
import { createBetterAuth } from './instance'

const authEnv = {
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'https://garden.example',
  RESEND_API_KEY: undefined,
}

function authFor(request: Request) {
  return createBetterAuth(null as unknown as Db, { ...authEnv, request })
}

function signInRequest(origin?: string) {
  const headers = new Headers({
    cookie: 'better-auth.session_token=session',
    'content-type': 'application/json',
  })
  if (origin !== undefined) headers.set('origin', origin)

  return new Request('https://garden.example/api/auth/sign-in/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: 'person@example.com',
      password: 'not-a-real-password',
    }),
  })
}

describe('createBetterAuth origin protection', () => {
  it.each([
    ['foreign', 'https://attacker.example'],
    ['missing', undefined],
    ['null', 'null'],
  ])('rejects %s origins before database access', async (_label, origin) => {
    const request = signInRequest(origin)
    const response = await authFor(request).handler(request)

    expect(response.status).toBe(403)
  })

  it('blocks a no-cookie cross-site form login', async () => {
    const request = new Request(
      'https://garden.example/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://attacker.example',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'cross-site',
        },
        body: new URLSearchParams({
          email: 'person@example.com',
          password: 'not-a-real-password',
        }),
      },
    )
    const response = await authFor(request).handler(request)

    expect(response.status).toBe(403)
  })

  it('allows a trusted origin past origin validation', async () => {
    const request = signInRequest('https://garden.example')
    const response = await authFor(request).handler(request)

    expect(response.status).not.toBe(403)
  })
})
