import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGardenLogger,
  errorFields,
  requestFields,
  setGardenLogLevel,
  withRequestIdHeader,
} from './logger'

afterEach(() => {
  setGardenLogLevel(null)
  vi.restoreAllMocks()
})

describe('createGardenLogger', () => {
  it('emits structured JSON and preserves user ids', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const logger = createGardenLogger({
      service: 'garden-staging',
      component: 'test',
      base: { environment: 'test' },
    })

    logger.info('auth.session.loaded', {
      userId: 'user-123',
      authorization: 'Bearer secret-token',
    })

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      source: 'garden',
      schemaVersion: 1,
      level: 'info',
      service: 'garden-staging',
      component: 'test',
      environment: 'test',
      event: 'auth.session.loaded',
      userId: 'user-123',
      authorization: '[redacted]',
    })

  })

  it('filters records below the configured log level', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createGardenLogger({
      service: 'garden-staging',
      component: 'test',
    })

    setGardenLogLevel('warn')

    logger.info('agent.request.connecting')
    logger.warn('agent.request.access_denied')

    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      level: 'warn',
      event: 'agent.request.access_denied',
    })
  })

  it('redacts secret-looking nested values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createGardenLogger({
      service: 'garden-mcp-proxy',
      component: 'test',
    })

    logger.warn('connector.failed', {
      payload: {
        databaseUrl: 'postgres://user:pass@example.com/db',
        ok: false,
      },
    })

    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      payload: {
        databaseUrl: '[redacted]',
        ok: false,
      },
    })

    warn.mockRestore()
  })
})

describe('errorFields', () => {
  it('keeps cause chains and custom error fields without leaking secrets', () => {
    const cause = new Error('database unavailable')
    const error = Object.assign(new Error('skill import failed', { cause }), {
      code: 'HTTPError',
      status: 500,
      sessionToken: 'secret-token',
    })

    expect(errorFields(error)).toMatchObject({
      errorName: 'Error',
      errorMessage: 'skill import failed',
      errorCode: 'HTTPError',
      errorStatus: 500,
      errorSessionToken: '[redacted]',
      errorCause: {
        errorName: 'Error',
        errorMessage: 'database unavailable',
      },
    })
  })

  it('keeps aggregate error members in bounded form', () => {
    const error = new AggregateError(
      [new Error('first'), new Error('second')],
      'batch failed',
    )

    expect(errorFields(error)).toMatchObject({
      errorName: 'AggregateError',
      errorMessage: 'batch failed',
      errorErrors: [
        { errorName: 'Error', errorMessage: 'first' },
        { errorName: 'Error', errorMessage: 'second' },
      ],
    })
  })
})

describe('requestFields', () => {
  it('uses request ids from headers before generating one', () => {
    const fields = requestFields(
      new Request('https://garden.example/workspace', {
        headers: {
          'x-request-id': 'request-1',
          'cf-ray': 'ray-1',
        },
      }),
    )

    expect(fields).toEqual({
      requestId: 'request-1',
      cfRay: 'ray-1',
      method: 'GET',
      path: '/workspace',
    })
  })
})

describe('withRequestIdHeader', () => {
  it('adds request ids to ordinary HTTP responses', async () => {
    const response = withRequestIdHeader(
      new Response('ok', { status: 201 }),
      'request-1',
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('x-garden-request-id')).toBe('request-1')
    expect(await response.text()).toBe('ok')
  })

  it('passes through statuses the Response constructor cannot rebuild', () => {
    const response = Response.error()

    expect(response.status).toBe(0)
    expect(withRequestIdHeader(response, 'request-1')).toBe(response)
  })
})
