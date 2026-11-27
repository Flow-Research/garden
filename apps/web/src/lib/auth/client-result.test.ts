import { describe, expect, it } from 'vitest'
import { AuthClientOperationError, authClientOperation } from './client-result'

describe('authClientOperation', () => {
  it('keeps a successful Better Auth response', async () => {
    const response = { data: { id: 'account-id' }, error: null }
    const result = await authClientOperation({
      fallbackMessage: 'Authentication failed',
      operation: 'test-auth',
      request: async () => response,
    })

    expect(
      result.match({
        ok: (value) => value,
        err: () => null,
      }),
    ).toBe(response)
  })

  it('maps a resolved Better Auth error', async () => {
    const cause = { message: 'Google rejected the request' }
    const result = await authClientOperation({
      fallbackMessage: 'Authentication failed',
      operation: 'google-sign-in',
      request: async () => ({ error: cause }),
    })

    const error = result.match({
      ok: () => null,
      err: (operationError) => operationError,
    })
    expect(error).toBeInstanceOf(AuthClientOperationError)
    expect(error).toMatchObject({
      cause,
      message: 'Google rejected the request',
      operation: 'google-sign-in',
    })
  })

  it('uses the fallback for a resolved error without a message', async () => {
    const result = await authClientOperation({
      fallbackMessage: 'Could not link Google',
      operation: 'link-google',
      request: async () => ({ error: {} }),
    })

    expect(
      result.match({
        ok: () => null,
        err: (error) => error.message,
      }),
    ).toBe('Could not link Google')
  })

  it('maps a rejected request and preserves its message', async () => {
    const cause = new Error('Network unavailable')
    const result = await authClientOperation({
      fallbackMessage: 'Authentication failed',
      operation: 'google-sign-in',
      request: async () => await Promise.reject(cause),
    })

    const error = result.match({
      ok: () => null,
      err: (operationError) => operationError,
    })
    expect(error).toMatchObject({
      cause,
      message: 'Network unavailable',
      operation: 'google-sign-in',
    })
  })

  it('uses the fallback for a rejected non-error value', async () => {
    const result = await authClientOperation({
      fallbackMessage: 'Could not unlink Google',
      operation: 'unlink-google',
      request: async () => await Promise.reject('offline'),
    })

    expect(
      result.match({
        ok: () => null,
        err: (error) => error.message,
      }),
    ).toBe('Could not unlink Google')
  })
})
