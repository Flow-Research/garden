import { describe, expect, it, vi } from 'vitest'
import {
  claimGitHubWebhookDelivery,
  githubWebhookCommentOrderScope,
  githubWebhookIssueOrderScope,
} from './github-webhook-delivery'

describe('githubWebhook order scopes', () => {
  it('keeps issue and comment streams separate', () => {
    expect(githubWebhookIssueOrderScope('bind-1')).toBe('binding:bind-1:issue')
    expect(githubWebhookCommentOrderScope('bind-1', '99')).toBe(
      'binding:bind-1:comment:99',
    )
  })
})

describe('claimGitHubWebhookDelivery', () => {
  it('rejects missing delivery id', async () => {
    const result = await claimGitHubWebhookDelivery({
      db: {} as never,
      deliveryId: null,
      event: 'issues',
      action: 'edited',
      installationId: '1',
      orderScope: 'binding:b:issue',
      orderMarker: 1,
      bindingId: 'b',
      workspaceId: 'w',
    })
    expect(result.isErr() && result.error.code).toBe('missing_delivery_id')
  })

  it('returns duplicate when insert conflicts', async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => []),
          })),
        })),
      })),
    }
    const result = await claimGitHubWebhookDelivery({
      db: db as never,
      deliveryId: 'd-1',
      event: 'issues',
      action: 'edited',
      installationId: '1',
      orderScope: 'binding:b:issue',
      orderMarker: 10,
      bindingId: 'b',
      workspaceId: 'w',
    })
    expect(result.isOk() && result.value).toEqual({ kind: 'duplicate' })
  })

  it('returns out_of_order when marker is behind an applied delivery', async () => {
    const updateWhere = vi.fn(async () => undefined)
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: 'row-1' }]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => [
                { orderMarker: 20, deliveryId: 'older-newer' },
              ]),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: updateWhere,
        })),
      })),
    }
    const result = await claimGitHubWebhookDelivery({
      db: db as never,
      deliveryId: 'd-stale',
      event: 'issues',
      action: 'edited',
      installationId: '1',
      orderScope: 'binding:b:issue',
      orderMarker: 5,
      bindingId: 'b',
      workspaceId: 'w',
    })
    expect(result.isOk() && result.value).toEqual({ kind: 'out_of_order' })
    expect(updateWhere).toHaveBeenCalled()
  })

  it('returns proceed when claim succeeds and marker is newest', async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: 'row-1' }]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => [
                { orderMarker: 5, deliveryId: 'older' },
              ]),
            })),
          })),
        })),
      })),
    }
    const result = await claimGitHubWebhookDelivery({
      db: db as never,
      deliveryId: 'd-new',
      event: 'issues',
      action: 'closed',
      installationId: '1',
      orderScope: 'binding:b:issue',
      orderMarker: 10,
      bindingId: 'b',
      workspaceId: 'w',
    })
    expect(result.isOk() && result.value).toEqual({ kind: 'proceed' })
  })
})
