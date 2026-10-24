import { Result, TaggedError } from 'better-result'

const textEncoder = new TextEncoder()

export class GitHubWebhookVerifyError extends TaggedError(
  'GitHubWebhookVerifyError',
)<{
  code: 'missing_secret' | 'missing_signature' | 'invalid_signature'
  message: string
}>() {}

function hexFromBytes(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Constant-time hex compare. Length mismatch fails without short-circuiting
 * the digest work already done for the provided signature.
 */
function timingSafeEqualHex(expected: string, provided: string) {
  const max = Math.max(expected.length, provided.length)
  let difference = expected.length === provided.length ? 0 : 1
  for (let index = 0; index < max; index += 1) {
    difference |=
      (expected.charCodeAt(index) || 0) ^ (provided.charCodeAt(index) || 0)
  }
  return difference === 0
}

function asBodyBytes(source: BufferSource): Uint8Array {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
  }
  return new Uint8Array(source)
}

/**
 * Verifies GitHub App webhook HMAC (`X-Hub-Signature-256: sha256=<hex>`).
 * Uses the raw request body bytes — never a re-serialized JSON string.
 * Empty/missing `GITHUB_WEBHOOK_SECRET` never authorizes (#161).
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export async function verifyGitHubWebhookSignature(args: {
  secret: string | undefined
  /** Raw delivery bytes — ArrayBuffer or TypedArray (Workers/undici vary). */
  rawBody: BufferSource
  signatureHeader: string | null
}): Promise<Result<true, GitHubWebhookVerifyError>> {
  const secret = args.secret?.trim()
  if (!secret) {
    return Result.err(
      new GitHubWebhookVerifyError({
        code: 'missing_secret',
        message: 'GitHub webhook secret is not configured',
      }),
    )
  }

  const header = args.signatureHeader?.trim() ?? ''
  const prefix = 'sha256='
  if (!header.startsWith(prefix) || header.length <= prefix.length) {
    return Result.err(
      new GitHubWebhookVerifyError({
        code: 'missing_signature',
        message: 'Missing or malformed X-Hub-Signature-256 header',
      }),
    )
  }
  const providedHex = header.slice(prefix.length).toLowerCase()

  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  // Normalize: undici Request.arrayBuffer() / views vary across runtimes.
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    asBodyBytes(args.rawBody),
  )
  const expectedHex = hexFromBytes(digest)

  if (!timingSafeEqualHex(expectedHex, providedHex)) {
    return Result.err(
      new GitHubWebhookVerifyError({
        code: 'invalid_signature',
        message: 'GitHub webhook signature mismatch',
      }),
    )
  }

  return Result.ok(true)
}
