import { describe, expect, it } from 'vitest'
import { serviceErrorResponse } from './service-error-response'

describe('serviceErrorResponse', () => {
  it('does not return runtime diagnostics to the API client', async () => {
    const response = serviceErrorResponse({
      code: 'runtime_error',
      message: 'provider detail with private input',
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'The service could not complete the request.',
    })
  })
})
