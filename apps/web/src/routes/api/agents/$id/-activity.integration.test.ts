import type { AppRequestContext } from '@/lib/server/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './activity'
import { invokeRouteHandler } from '@/test/route-handler'

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  resolveWorkspaceId: vi.fn(),
}))

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/control-plane')>()
  return {
    ...actual,
    requireSession: mocks.requireSession,
    resolveWorkspaceId: mocks.resolveWorkspaceId,
  }
})

describe('agent activity route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireSession.mockResolvedValue({
      user: { id: 'member-id' },
    })
    mocks.resolveWorkspaceId.mockResolvedValue('workspace-id')
  })

  it('rejects unauthenticated callers', async () => {
    mocks.requireSession.mockResolvedValueOnce(null)

    const response = await invokeRouteHandler(Route, 'GET', {
      context: {} as AppRequestContext,
      request: new Request('https://garden.test/api/agents/agent-id/activity'),
      params: { id: 'agent-id' },
    })

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(401)
  })

  it('merges tool decisions and grant changes newest first', async () => {
    const decisions = [
      {
        id: 'decision-new',
        toolCallId: 'call-new',
        toolName: 'add_issue_comment',
        connectorId: 'github',
        resultStatus: 'approved',
        error: null,
        timestamp: new Date('2026-09-02T10:00:00Z'),
      },
      {
        id: 'decision-old',
        toolCallId: 'call-old',
        toolName: 'delete_repo',
        connectorId: 'github',
        resultStatus: 'denied',
        error: 'User denied approval',
        timestamp: new Date('2026-09-01T10:00:00Z'),
      },
    ]
    const grantChanges = [
      {
        id: 'grant-mid',
        eventType: 'permission.grant.set',
        payload: {
          scope: 'connection',
          connector_id: 'github',
          trust: 'allow',
        },
        timestamp: new Date('2026-09-01T12:00:00Z'),
      },
    ]
    let selectCalls = 0

    const db = {
      select: vi.fn(() => {
        selectCalls += 1
        if (selectCalls === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve([{ id: 'agent-id' }])),
              })),
            })),
          }
        }
        const rows = selectCalls === 2 ? decisions : grantChanges
        const orderLimit = {
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(rows)),
          })),
        }
        return {
          from: vi.fn(() =>
            selectCalls === 2
              ? {
                  innerJoin: vi.fn(() => ({
                    where: vi.fn(() => orderLimit),
                  })),
                }
              : {
                  where: vi.fn(() => orderLimit),
                },
          ),
        }
      }),
    }

    const response = await invokeRouteHandler(Route, 'GET', {
      context: {
        db: async () => db,
      } as unknown as AppRequestContext,
      request: new Request('https://garden.test/api/agents/agent-id/activity'),
      params: { id: 'agent-id' },
    })

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(200)
    const body = (await response?.json()) as { events: Array<{ id: string }> }
    expect(body.events.map((event) => event.id)).toEqual([
      'decision-new',
      'grant-mid',
      'decision-old',
    ])
  })
})
