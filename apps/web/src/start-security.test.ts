// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { serverFunctionCsrf } from './start'
import { calls } from './test/start-security/resolver'

vi.hoisted(() => {
  process.env.TSS_SERVER_FN_BASE = '/_serverFn/'
  process.env.TSS_DEV_SERVER = 'true'
})

let handler: ReturnType<
  typeof import('@tanstack/react-start/server').createStartHandler
>
beforeAll(async () => {
  const { createStartHandler } = await import('@tanstack/react-start/server')
  handler = createStartHandler(
    () => new Response('Unexpected SSR', { status: 500 }),
  )
})
beforeEach(() => {
  calls.length = 0
})

function request(values: Record<string, string | undefined>) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) headers.set(key, value)
  return new Request('https://garden.example/_serverFn/security-fixture', {
    method: 'POST',
    headers,
  })
}

describe('installed Start server-function handler with Garden middleware', () => {
  it.each([
    { origin: 'https://garden.example' },
    { 'sec-fetch-site': 'same-origin' },
    { referer: 'https://garden.example/settings' },
  ])('executes a same-origin action with %j', async (headers) => {
    const response = await handler(request(headers))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('same-origin action executed')
    expect(calls).toEqual(['security-fixture'])
  })

  it.each([
    {},
    { origin: 'https://foreign.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site', origin: 'https://garden.example' },
    { referer: 'https://foreign.example', origin: 'https://foreign.example' },
    { origin: 'https://foreign.example', referer: 'https://garden.example' },
  ])('refuses an action with %j before execution', async (headers) => {
    const response = await handler(request(headers))
    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('preserves origin-free callback and signed transport requests for their own route checks', async () => {
    for (const pathname of [
      '/api/auth/oauth2/callback/gmail',
      '/api/workstream/callback',
      '/api/execution-hosts/receive',
    ]) {
      const request = new Request(`https://garden.example${pathname}`, {
        headers: { 'x-signature': 'fixture-signature' },
      })
      const next = vi.fn(async () => ({
        response: new Response('route owns authorization'),
        request,
        pathname,
        context: {},
      }))
      const result = await serverFunctionCsrf.options.server!({
        request,
        pathname,
        handlerType: 'router',
        context: {},
        next,
      } as never)
      expect(next).toHaveBeenCalledOnce()
      if (result instanceof Response)
        throw new Error('Router request was intercepted')
      expect(result.response.status).toBe(200)
      expect(result.request.headers.get('x-signature')).toBe(
        'fixture-signature',
      )
    }
  })
})
