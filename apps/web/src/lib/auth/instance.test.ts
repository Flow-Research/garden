import { describe, expect, it, vi } from 'vitest'
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

describe('createBetterAuth Google sign-in policy', () => {
  it('configures Google sign-in only from the dedicated auth credentials', () => {
    const auth = createBetterAuth(null as unknown as Db, {
      ...authEnv,
      GOOGLE_AUTH_CLIENT_ID: 'google-auth-client',
      GOOGLE_AUTH_CLIENT_SECRET: 'google-auth-secret',
      GOOGLE_CLIENT_ID: 'google-connector-client',
      GOOGLE_CLIENT_SECRET: 'google-connector-secret',
    })

    expect(auth.options.socialProviders?.google).toMatchObject({
      clientId: 'google-auth-client',
      clientSecret: 'google-auth-secret',
    })
  })

  it('does not use connector credentials for Google sign-in', () => {
    const auth = createBetterAuth(null as unknown as Db, {
      ...authEnv,
      GOOGLE_CLIENT_ID: 'google-connector-client',
      GOOGLE_CLIENT_SECRET: 'google-connector-secret',
    })

    expect(auth.options.socialProviders).toBeUndefined()
  })

  it('rejects a partial Google sign-in credential pair', () => {
    expect(() =>
      createBetterAuth(null as unknown as Db, {
        ...authEnv,
        GOOGLE_AUTH_CLIENT_ID: 'google-auth-client',
      }),
    ).toThrow(
      'GOOGLE_AUTH_CLIENT_ID and GOOGLE_AUTH_CLIENT_SECRET must be set together',
    )
  })

  it('keeps session authorization available with a partial Google pair', () => {
    const auth = createBetterAuth(null as unknown as Db, {
      ...authEnv,
      GOOGLE_AUTH_CLIENT_ID: 'google-auth-client',
      authMode: 'session',
    })

    expect(auth.options.socialProviders).toBeUndefined()
  })

  it('requires a verified local email before trusted Google linking', () => {
    const auth = createBetterAuth(null as unknown as Db, {
      ...authEnv,
      GOOGLE_AUTH_CLIENT_ID: 'google-auth-client',
      GOOGLE_AUTH_CLIENT_SECRET: 'google-auth-secret',
    })

    expect(auth.options.account?.accountLinking).toEqual({
      trustedProviders: ['google'],
      requireLocalEmailVerified: true,
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
    })
  })

  it('blocks Google unlink when connector accounts are the only alternatives', async () => {
    const auth = createBetterAuth(null as unknown as Db, authEnv)
    const beforeHook = auth.options.hooks?.before
    const findAccounts = vi
      .fn()
      .mockResolvedValue([{ providerId: 'google' }, { providerId: 'gmail' }])

    expect(beforeHook).toBeDefined()
    await expect(
      beforeHook?.({
        path: '/unlink-account',
        method: 'POST',
        body: { providerId: 'google' },
        context: {
          session: {
            session: { id: 'session-id' },
            user: { id: 'user-id' },
          },
          internalAdapter: { findAccounts },
        },
      } as never),
    ).rejects.toThrow('Google is your only sign-in method')
    expect(findAccounts).toHaveBeenCalledWith('user-id')
  })

  it('allows Google unlink when a password sign-in remains', async () => {
    const auth = createBetterAuth(null as unknown as Db, authEnv)
    const beforeHook = auth.options.hooks?.before
    const findAccounts = vi
      .fn()
      .mockResolvedValue([
        { providerId: 'google' },
        { providerId: 'credential' },
      ])

    expect(beforeHook).toBeDefined()
    await expect(
      beforeHook?.({
        path: '/unlink-account',
        method: 'POST',
        body: { providerId: 'google' },
        context: {
          session: {
            session: { id: 'session-id' },
            user: { id: 'user-id' },
          },
          internalAdapter: { findAccounts },
        },
      } as never),
    ).resolves.toBeUndefined()
    expect(findAccounts).toHaveBeenCalledWith('user-id')
  })

  it('blocks concurrent credential unlink while Google unlink proceeds', async () => {
    const auth = createBetterAuth(null as unknown as Db, authEnv)
    const beforeHook = auth.options.hooks?.before
    const findAccounts = vi
      .fn()
      .mockResolvedValue([
        { providerId: 'google' },
        { providerId: 'credential' },
        { providerId: 'gmail' },
      ])
    const unlinkContext = (providerId: 'credential' | 'google') =>
      ({
        path: '/unlink-account',
        method: 'POST',
        body: { providerId },
        context: {
          session: {
            session: { id: 'session-id' },
            user: { id: 'user-id' },
          },
          internalAdapter: { findAccounts },
        },
      }) as never

    expect(beforeHook).toBeDefined()
    const [googleResult, credentialResult] = await Promise.allSettled([
      beforeHook?.(unlinkContext('google')),
      beforeHook?.(unlinkContext('credential')),
    ])

    expect(googleResult).toEqual({ status: 'fulfilled', value: undefined })
    expect(credentialResult).toMatchObject({ status: 'rejected' })
    if (credentialResult.status === 'rejected') {
      expect(credentialResult.reason).toMatchObject({
        body: {
          code: 'CREDENTIAL_UNLINK_NOT_SUPPORTED',
          message: 'Password sign-in cannot be removed',
        },
      })
    }
    expect(findAccounts).toHaveBeenCalledTimes(1)
  })
})
