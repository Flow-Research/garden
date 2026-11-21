import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { createNativeFetch } from './transport'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((stop) => stop()))
})

/** Observes actual Fetch wire requests instead of mocking native controller calls. */
async function serverFor(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  )
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

it('preserves Request scope headers and supplies the exact native Origin and cookie', async () => {
  const origin = await serverFor((request, response) => {
    expect(request.headers['x-workspace-id']).toBe('workspace-a')
    expect(request.headers['x-request-id']).toBe('request-a')
    expect(request.headers.origin).toBe('garden-mobile://')
    expect(request.headers.cookie).toBe('session=fixture-only')
    response.end('ok')
  })
  const transport = createNativeFetch(
    origin,
    fetch,
    async () => 'session=fixture-only',
  )
  const response = await transport(
    new Request(`${origin}/api/skills`, {
      headers: { 'X-Workspace-ID': 'workspace-a', 'X-Request-ID': 'request-a' },
    }),
  )
  expect(response.status).toBe(200)
})

it('refuses another origin before reading credentials or making any request', async () => {
  let hits = 0
  let credentialReads = 0
  const foreign = await serverFor((_request, response) => {
    hits += 1
    response.end('foreign')
  })
  const transport = createNativeFetch(
    'https://garden.example',
    fetch,
    async () => {
      credentialReads += 1
      return 'private'
    },
  )
  expect((await transport(`${foreign}/api/skills`)).status).toBe(403)
  expect(hits).toBe(0)
  expect(credentialReads).toBe(0)
})

it('preserves SDK auth POST bodies and cookies while replacing an untrusted Origin', async () => {
  const origin = await serverFor(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        method: request.method,
        cookie: request.headers.cookie,
        origin: request.headers.origin,
        body,
      }),
    )
  })
  const transport = createNativeFetch(origin, fetch)
  const response = await transport(`${origin}/api/auth/sign-out`, {
    method: 'POST',
    headers: {
      cookie: 'session=fixture-only',
      origin: 'garden-mobile://unexpected',
      'content-type': 'application/json',
    },
    body: '{}',
  })
  expect(await response.json()).toEqual({
    method: 'POST',
    cookie: 'session=fixture-only',
    origin: 'garden-mobile://',
    body: '{}',
  })
})

it('refuses redirects under the standard Fetch contract without forwarding credentials', async () => {
  let foreignHits = 0
  const foreign = await serverFor((_request, response) => {
    foreignHits += 1
    response.end('foreign')
  })
  const origin = await serverFor((_request, response) => {
    response.writeHead(302, { location: `${foreign}/capture` })
    response.end()
  })
  const transport = createNativeFetch(
    origin,
    fetch,
    async () => 'session=fixture-only',
  )
  await expect(transport(`${origin}/api/skills`)).rejects.toBeInstanceOf(
    TypeError,
  )
  expect(foreignHits).toBe(0)
})
