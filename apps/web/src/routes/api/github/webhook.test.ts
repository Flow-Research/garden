import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Result } from 'better-result'
import { Route } from './webhook'
import { invokeRouteHandler } from '@/test/route-handler'
import type { AppRequestContext } from '@/lib/server/context'

const mocks = vi.hoisted(() => ({
  appEnv: {
    GITHUB_WEBHOOK_SECRET: 'garden-webhook-test-secret',
  },
  requireAppRequestContext: vi.fn(),
  resolveGitHubWebhookBinding: vi.fn(),
  applyGitHubWebhookIssueUpdate: vi.fn(),
  db: vi.fn(async () => ({})),
}))

vi.mock('@/lib/server/env', () => ({
  appEnv: mocks.appEnv,
}))

vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: mocks.requireAppRequestContext,
}))

vi.mock('@/lib/server/github-webhook-resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/github-webhook-resolve')>()
  return {
    ...actual,
    resolveGitHubWebhookBinding: mocks.resolveGitHubWebhookBinding,
  }
})

vi.mock('@/lib/server/github-webhook-apply', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/github-webhook-apply')>()
  return {
    ...actual,
    applyGitHubWebhookIssueUpdate: mocks.applyGitHubWebhookIssueUpdate,
  }
})

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

const issueEditedBody = JSON.stringify({
  action: 'edited',
  installation: { id: 99 },
  repository: {
    name: 'garden',
    full_name: 'Flow-Research/garden',
    owner: { login: 'Flow-Research' },
  },
  issue: {
    number: 42,
    title: 'Webhook sync',
    body: 'hello',
    state: 'open',
    html_url: 'https://github.com/Flow-Research/garden/issues/42',
  },
})

describe('POST /api/github/webhook', () => {
  beforeEach(() => {
    mocks.appEnv.GITHUB_WEBHOOK_SECRET = 'garden-webhook-test-secret'
    mocks.requireAppRequestContext.mockReturnValue({
      db: mocks.db,
    })
    mocks.resolveGitHubWebhookBinding.mockReset()
    mocks.applyGitHubWebhookIssueUpdate.mockReset()
    mocks.resolveGitHubWebhookBinding.mockResolvedValue(Result.ok(null))
    mocks.applyGitHubWebhookIssueUpdate.mockResolvedValue(
      Result.ok({
        applied: true,
        skippedReason: null,
        fields: ['title', 'description'],
      }),
    )
  })

  it('returns 200 for a verified ping without an issue', async () => {
    const response = await postWebhook({ body: '{"zen":"keep it simple"}' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'ignored' })
    expect(mocks.resolveGitHubWebhookBinding).not.toHaveBeenCalled()
    expect(mocks.applyGitHubWebhookIssueUpdate).not.toHaveBeenCalled()
  })

  it('returns unbound when no install/binding matches', async () => {
    const response = await postWebhook({ body: issueEditedBody })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'unbound' })
    expect(mocks.resolveGitHubWebhookBinding).toHaveBeenCalled()
    expect(mocks.applyGitHubWebhookIssueUpdate).not.toHaveBeenCalled()
  })

  it('applies updates when a binding is found', async () => {
    mocks.resolveGitHubWebhookBinding.mockResolvedValue(
      Result.ok({
        workspaceId: 'ws-1',
        issueId: 'issue-1',
        bindingId: 'bind-1',
        externalId: 'Flow-Research/garden/issues/42',
      }),
    )
    const response = await postWebhook({ body: issueEditedBody })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      status: 'applied',
      skipped_reason: null,
      fields: ['title', 'description'],
      workspace_id: 'ws-1',
      issue_id: 'issue-1',
      binding_id: 'bind-1',
    })
    expect(mocks.applyGitHubWebhookIssueUpdate).toHaveBeenCalled()
  })

  it('reports skipped when apply decides not to write', async () => {
    mocks.resolveGitHubWebhookBinding.mockResolvedValue(
      Result.ok({
        workspaceId: 'ws-1',
        issueId: 'issue-1',
        bindingId: 'bind-1',
        externalId: 'Flow-Research/garden/issues/42',
      }),
    )
    mocks.applyGitHubWebhookIssueUpdate.mockResolvedValue(
      Result.ok({
        applied: false,
        skippedReason: 'bot_sender',
        fields: [],
      }),
    )
    const response = await postWebhook({ body: issueEditedBody })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      status: 'skipped',
      skipped_reason: 'bot_sender',
    })
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
