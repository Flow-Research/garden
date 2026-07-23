import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePostHogException } from '../posthog-server'
import { captureApiFailure } from './api-logging'

vi.mock('../posthog-server', () => ({
  capturePostHogException: vi.fn(async () => undefined),
}))

afterEach(() => {
  vi.mocked(capturePostHogException).mockClear()
  vi.restoreAllMocks()
})

describe('captureApiFailure', () => {
  it('logs and forwards caught custom failures with request correlation', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = Object.assign(new Error('connector storage failed'), {
      status: 503,
      code: 'connector_unavailable',
    })
    const request = new Request(
      'https://garden.example/api/connections/google_gmail',
      { headers: { 'x-request-id': 'request-connector' } },
    )

    await captureApiFailure({
      request,
      event: 'connector.test.failed',
      error,
    })

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'connector.test.failed',
        requestId: 'request-connector',
        errorCode: 'connector_unavailable',
        errorStatus: 503,
      }),
    )
    expect(capturePostHogException).toHaveBeenCalledWith({
      error,
      properties: expect.objectContaining({
        event: 'connector.test.failed',
        requestId: 'request-connector',
        path: '/api/connections/google_gmail',
      }),
    })
  })
})
