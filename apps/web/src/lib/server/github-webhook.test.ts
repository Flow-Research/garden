import { describe, expect, it } from 'vitest'
import { verifyGitHubWebhookSignature } from './github-webhook'

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

describe('verifyGitHubWebhookSignature', () => {
  it('accepts a valid X-Hub-Signature-256 over the raw body', async () => {
    const secret = 'garden-webhook-test-secret'
    const rawBody = rawBodyFrom('{"action":"edited"}')
    const signatureHeader = await sign(secret, rawBody)

    const result = await verifyGitHubWebhookSignature({
      secret,
      rawBody,
      signatureHeader,
    })

    expect(result.isOk()).toBe(true)
  })

  it('rejects when the webhook secret is missing', async () => {
    const rawBody = rawBodyFrom('{}')
    const result = await verifyGitHubWebhookSignature({
      secret: '   ',
      rawBody,
      signatureHeader: await sign('other', rawBody),
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) throw new Error('expected missing secret')
    expect(result.error.code).toBe('missing_secret')
  })

  it('rejects a missing or malformed signature header', async () => {
    const rawBody = rawBodyFrom('{}')
    const missing = await verifyGitHubWebhookSignature({
      secret: 'secret',
      rawBody,
      signatureHeader: null,
    })
    const malformed = await verifyGitHubWebhookSignature({
      secret: 'secret',
      rawBody,
      signatureHeader: 'sha1=deadbeef',
    })

    expect(missing.isErr() && missing.error.code).toBe('missing_signature')
    expect(malformed.isErr() && malformed.error.code).toBe('missing_signature')
  })

  it('rejects a signature for a different body or secret', async () => {
    const secret = 'garden-webhook-test-secret'
    const rawBody = rawBodyFrom('{"action":"closed"}')
    const wrongBody = rawBodyFrom('{"action":"opened"}')
    const result = await verifyGitHubWebhookSignature({
      secret,
      rawBody,
      signatureHeader: await sign(secret, wrongBody),
    })
    const wrongSecret = await verifyGitHubWebhookSignature({
      secret,
      rawBody,
      signatureHeader: await sign('other-secret', rawBody),
    })

    expect(result.isErr() && result.error.code).toBe('invalid_signature')
    expect(wrongSecret.isErr() && wrongSecret.error.code).toBe(
      'invalid_signature',
    )
  })
})
