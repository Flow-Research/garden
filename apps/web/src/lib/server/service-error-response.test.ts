import { describe, expect, it } from 'vitest'
import { serviceErrorResponse } from './service-error-response'

describe('canonical service error responses', () => {
  it('redacts database messages regardless of the requested status', async () => {
    const response = serviceErrorResponse({
      code: 'db_error',
      message: 'private SQL and connection details',
      status: 401,
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'The database is unavailable. Try again shortly.',
    })
  })
  it('preserves explicit execution-host refusals and immutable identity conflicts', async () => {
    for (const status of [400, 401, 403, 503]) {
      const response = serviceErrorResponse({
        code: 'host_refused',
        message: 'Current authority is required',
        status,
      })
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({
        error: 'Current authority is required',
      })
    }
    expect(
      serviceErrorResponse({
        code: 'host_conflict',
        message: 'Immutable identity differs',
        status: 200,
      }).status,
    ).toBe(409)
  })
  it('cannot turn an invalid refusal status into a successful or redirected response', () => {
    for (const status of [200, 302, 500, NaN, undefined])
      expect(
        serviceErrorResponse({
          code: 'host_refused',
          message: 'Refused',
          status,
        }).status,
      ).toBe(403)
  })
  it('keeps existing runtime, not-found and caller-failure mappings', () => {
    expect(
      serviceErrorResponse({
        code: 'runtime_error',
        message: 'Runtime unavailable',
      }).status,
    ).toBe(502)
    expect(
      serviceErrorResponse({
        code: 'issue_not_found',
        message: 'Issue not found',
      }).status,
    ).toBe(404)
    expect(
      serviceErrorResponse({
        code: 'invalid_input',
        message: 'Bad input',
        status: 200,
      }).status,
    ).toBe(400)
  })
})
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
