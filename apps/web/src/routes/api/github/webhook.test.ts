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
  applyGitHubWebhookComment: vi.fn(),
  claimGitHubWebhookDelivery: vi.fn(),
  applyIssueMutationSideEffects: vi.fn(),
  publishCommentChangedEvent: vi.fn(),
  db: vi.fn(async () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [
            {
              id: 'issue-1',
              workspaceId: 'ws-1',
              teamId: null,
              assigneeId: null,
              status: 'done',
              title: 'Webhook sync',
              description: 'hello',
              assigneeType: null,
              number: 1,
              createdBy: 'user-1',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        })),
      })),
    })),
  })),
  waitUntil: vi.fn(),
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
    applyGitHubWebhookComment: mocks.applyGitHubWebhookComment,
  }
})

vi.mock('@/lib/server/github-webhook-delivery', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/server/github-webhook-delivery')
    >()
  return {
    ...actual,
    claimGitHubWebhookDelivery: mocks.claimGitHubWebhookDelivery,
  }
})

vi.mock('@/lib/server/issue-mutation-effects', () => ({
  applyIssueMutationSideEffects: mocks.applyIssueMutationSideEffects,
  publishCommentChangedEvent: mocks.publishCommentChangedEvent,
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
  deliveryId?: string | null
  event?: string
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
  if (args.deliveryId !== null) {
    headers.set('x-github-delivery', args.deliveryId ?? 'delivery-test-1')
  }
  if (args.event) headers.set('x-github-event', args.event)
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
    updated_at: '2026-04-01T12:00:00Z',
  },
})

describe('POST /api/github/webhook', () => {
  beforeEach(() => {
    mocks.appEnv.GITHUB_WEBHOOK_SECRET = 'garden-webhook-test-secret'
    mocks.requireAppRequestContext.mockReturnValue({
      db: mocks.db,
      waitUntil: mocks.waitUntil,
      env: mocks.appEnv,
    })
    mocks.resolveGitHubWebhookBinding.mockReset()
    mocks.applyGitHubWebhookIssueUpdate.mockReset()
    mocks.applyGitHubWebhookComment.mockReset()
    mocks.claimGitHubWebhookDelivery.mockReset()
    mocks.applyIssueMutationSideEffects.mockReset()
    mocks.publishCommentChangedEvent.mockReset()
    mocks.resolveGitHubWebhookBinding.mockResolvedValue(Result.ok(null))
    mocks.claimGitHubWebhookDelivery.mockResolvedValue(
      Result.ok({ kind: 'proceed' }),
    )
    mocks.applyIssueMutationSideEffects.mockResolvedValue(undefined)
    mocks.applyGitHubWebhookIssueUpdate.mockResolvedValue(
      Result.ok({
        applied: true,
        skippedReason: null,
        fields: ['title', 'description'],
        previousStatus: 'todo',
        previousAssigneeType: null,
        previousAssigneeId: null,
        statusChanged: false,
      }),
    )
    mocks.applyGitHubWebhookComment.mockResolvedValue(
      Result.ok({
        applied: true,
        skippedReason: null,
        action: 'created',
        commentId: 'comment-1',
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
    expect(mocks.claimGitHubWebhookDelivery).not.toHaveBeenCalled()
    expect(mocks.applyGitHubWebhookIssueUpdate).not.toHaveBeenCalled()
  })

  it('applies updates when a binding is found and publishes lifecycle', async () => {
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
    expect(mocks.applyIssueMutationSideEffects).toHaveBeenCalled()
  })

  it('returns duplicate for a replayed delivery id', async () => {
    mocks.resolveGitHubWebhookBinding.mockResolvedValue(
      Result.ok({
        workspaceId: 'ws-1',
        issueId: 'issue-1',
        bindingId: 'bind-1',
        externalId: 'Flow-Research/garden/issues/42',
      }),
    )
    mocks.claimGitHubWebhookDelivery.mockResolvedValue(
      Result.ok({ kind: 'duplicate' }),
    )
    const response = await postWebhook({
      body: issueEditedBody,
      deliveryId: 'same-delivery',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'duplicate' })
    expect(mocks.applyGitHubWebhookIssueUpdate).not.toHaveBeenCalled()
  })

  it('returns out_of_order for a stale delivery', async () => {
    mocks.resolveGitHubWebhookBinding.mockResolvedValue(
      Result.ok({
        workspaceId: 'ws-1',
        issueId: 'issue-1',
        bindingId: 'bind-1',
        externalId: 'Flow-Research/garden/issues/42',
      }),
    )
    mocks.claimGitHubWebhookDelivery.mockResolvedValue(
      Result.ok({ kind: 'out_of_order' }),
    )
    const response = await postWebhook({ body: issueEditedBody })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'out_of_order' })
    expect(mocks.applyGitHubWebhookIssueUpdate).not.toHaveBeenCalled()
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
        previousStatus: null,
        previousAssigneeType: null,
        previousAssigneeId: null,
        statusChanged: false,
      }),
    )
    const response = await postWebhook({ body: issueEditedBody })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      status: 'skipped',
      skipped_reason: 'bot_sender',
    })
    expect(mocks.applyIssueMutationSideEffects).not.toHaveBeenCalled()
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

  it('applies issue_comment deliveries and publishes comment events', async () => {
    mocks.resolveGitHubWebhookBinding.mockResolvedValue(
      Result.ok({
        workspaceId: 'ws-1',
        issueId: 'issue-1',
        bindingId: 'bind-1',
        externalId: 'Flow-Research/garden/issues/42',
      }),
    )
    const body = JSON.stringify({
      action: 'created',
      installation: { id: 99 },
      repository: {
        name: 'garden',
        full_name: 'Flow-Research/garden',
        owner: { login: 'Flow-Research' },
      },
      issue: {
        number: 42,
        html_url: 'https://github.com/Flow-Research/garden/issues/42',
      },
      comment: {
        id: 55,
        body: 'hello from gh',
        updated_at: '2026-04-01T12:00:00Z',
        user: { id: 1, login: 'octocat', type: 'User' },
      },
      sender: { type: 'User' },
    })
    const response = await postWebhook({ body, event: 'issue_comment' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      status: 'applied',
      skipped_reason: null,
      comment_action: 'created',
      workspace_id: 'ws-1',
      issue_id: 'issue-1',
      binding_id: 'bind-1',
    })
    expect(mocks.applyGitHubWebhookComment).toHaveBeenCalled()
    expect(mocks.applyGitHubWebhookIssueUpdate).not.toHaveBeenCalled()
    expect(mocks.publishCommentChangedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        commentId: 'comment-1',
        issueId: 'issue-1',
      }),
    )
  })
})
