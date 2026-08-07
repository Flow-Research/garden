import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePostHogException } from '../posthog-server'
import { runExecutorRouteEffect } from './executor-observability'

vi.mock('../posthog-server', () => ({
  capturePostHogException: vi.fn(async () => undefined),
}))

class TestHttpFailure extends Error {
  readonly status: number
  readonly cause?: unknown

  constructor(status: number, message: string, cause?: unknown) {
    super(message)
    this.name = 'TestHttpFailure'
    this.status = status
    this.cause = cause
  }
}

afterEach(() => {
  vi.mocked(capturePostHogException).mockClear()
  vi.restoreAllMocks()
})

describe('runExecutorRouteEffect', () => {
  it('returns successful Effect values unchanged', async () => {
    const outcome = await runExecutorRouteEffect({
      effect: Effect.succeed('ready'),
      request: new Request('https://garden.example/api/executor/test'),
      event: 'executor.test.failed',
      fallbackMessage: 'Executor failed.',
    })

    expect(outcome).toEqual({ ok: true, value: 'ready' })
    expect(capturePostHogException).not.toHaveBeenCalled()
  })

  it('captures typed 5xx failures with a traceable sanitized response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rootCause = new Error('D1 unavailable')
    const outcome = await runExecutorRouteEffect({
      effect: Effect.fail(
        new TestHttpFailure(503, 'Connector service unavailable.', rootCause),
      ),
      request: new Request('https://garden.example/api/executor/test', {
        headers: { 'x-request-id': 'request-503' },
      }),
      event: 'executor.test.failed',
      fallbackMessage: 'Executor failed.',
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.response.status).toBe(503)
    expect(outcome.response.headers.get('x-garden-error-capture')).toMatch(
      /^executor-/,
    )
    await expect(outcome.response.json()).resolves.toMatchObject({
      error: 'Connector service unavailable.',
      requestId: 'request-503',
      traceId: expect.stringMatching(/^executor-/),
    })
    expect(capturePostHogException).toHaveBeenCalledTimes(1)
    expect(capturePostHogException).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Connector service unavailable.',
          cause: rootCause,
        }),
        properties: expect.objectContaining({
          event: 'executor.test.failed',
          requestId: 'request-503',
        }),
      }),
    )
  })

  it('logs expected 4xx failures without error tracking noise', async () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outcome = await runExecutorRouteEffect({
      effect: Effect.fail(new TestHttpFailure(400, 'Invalid request.')),
      request: new Request('https://garden.example/api/executor/test'),
      event: 'executor.test.failed',
      fallbackMessage: 'Executor failed.',
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.response.status).toBe(400)
    expect(outcome.response.headers.has('x-garden-error-capture')).toBe(false)
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'executor.test.failed',
        errorStatus: 400,
      }),
    )
    expect(capturePostHogException).not.toHaveBeenCalled()
  })
})
