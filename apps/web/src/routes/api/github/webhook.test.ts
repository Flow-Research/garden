import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './webhook'
import { invokeRouteHandler } from '@/test/route-handler'
import type { AppRequestContext } from '@/lib/server/context'

const mocks = vi.hoisted(() => ({
  appEnv: {
    GITHUB_WEBHOOK_SECRET: 'garden-webhook-test-secret',
  },
}))

vi.mock('@/lib/server/env', () => ({
  appEnv: mocks.appEnv,
}))

const textEncoder = new TextEncoder()

function rawBodyFrom(text: string) {
  const bytes = textEncoder.encode(text)
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
}

async function sign(secret: string, body: ArrayBuffer) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, body)
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${hex}`
}

async function postWebhook(args: {
  body: string
  signature?: string | null
}) {
  const rawBody = rawBodyFrom(args.body)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (args.signature !== null) {
    headers.set(
      'x-hub-signature-256',
      args.signature ??
        (await sign(mocks.appEnv.GITHUB_WEBHOOK_SECRET, rawBody)),
    )
  }
  return invokeRouteHandler(Route, 'POST', {
    context: {} as AppRequestContext,
    request: new Request('http://localhost:3000/api/github/webhook', {
      method: 'POST',
      headers,
      body: args.body,
    }),
  })
}

describe('POST /api/github/webhook', () => {
  beforeEach(() => {
    mocks.appEnv.GITHUB_WEBHOOK_SECRET = 'garden-webhook-test-secret'
  })

  it('returns 200 for a verified delivery', async () => {
    const response = await postWebhook({ body: '{"zen":"keep it simple"}' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('returns 400 when the signature header is missing', async () => {
    const response = await postWebhook({
      body: '{}',
      signature: null,
    })
    expect(response.status).toBe(400)
  })

  it('returns 401 when the signature does not match', async () => {
    const response = await postWebhook({
      body: '{}',
      signature: 'sha256=deadbeef',
    })
    expect(response.status).toBe(401)
  })

  it('returns 503 when the webhook secret is not configured', async () => {
    mocks.appEnv.GITHUB_WEBHOOK_SECRET = ''
    const response = await postWebhook({
      body: '{}',
      signature: 'sha256=00',
    })
    expect(response.status).toBe(503)
  })
})
