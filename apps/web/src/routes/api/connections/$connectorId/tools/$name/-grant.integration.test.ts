import type { AppRequestContext } from '@/lib/server/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './grant'

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  capturePostHogEvent: vi.fn(),
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

vi.mock('@/lib/server/workspace-permissions', () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
  workspacePermissions: {
    permissionManage: { permission: ['approve', 'grant'] },
  },
}))

vi.mock('@/lib/posthog-server', () => ({
  capturePostHogEvent: mocks.capturePostHogEvent,
}))

function getPatchHandler() {
  const handlers = Route.options.server?.handlers

  if (!handlers || typeof handlers === 'function') {
    throw new Error('Expected connection grant route handlers')
  }

  const patchHandler = handlers.PATCH

  if (typeof patchHandler !== 'function') {
    throw new Error('Expected connection grant PATCH handler')
  }

  return patchHandler
}

describe('connection grant route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireSession.mockResolvedValue({
      user: { id: 'member-id' },
    })
    mocks.resolveWorkspaceId.mockResolvedValue('workspace-id')
    mocks.requireWorkspacePermission.mockResolvedValue(
      Response.json({ error: 'Forbidden' }, { status: 403 }),
    )
  })

  it('rejects members without permissionManage before parsing the grant', async () => {
    const request = new Request(
      'https://garden.test/api/connections/github/tools/create_issue/grant',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json',
      },
    )

    const response = await getPatchHandler()({
      context: {} as AppRequestContext,
      request,
      params: {
        connectorId: 'github',
        name: 'create_issue',
      },
      pathname: '/api/connections/$connectorId/tools/$name/grant',
      next: () => ({ isNext: true, context: undefined }),
    })

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(403)
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith({
      appContext: expect.anything(),
      request,
      workspaceId: 'workspace-id',
      permissions: {
        permission: ['approve', 'grant'],
      },
    })
  })

  it('allows members with permissionManage to update the grant', async () => {
    const agentId = '00000000-0000-4000-8000-000000000001'

    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ id: agentId }])
      .mockResolvedValueOnce([
        {
          id: 'capability-id',
          riskClass: 'write',
        },
      ])

    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)

    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit,
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate,
        })),
      })),
    }

    mocks.requireWorkspacePermission.mockResolvedValueOnce(null)

    const request = new Request(
      'https://garden.test/api/connections/github/tools/create_issue/grant',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          trustLevel: 'allow',
        }),
      },
    )

    const response = await getPatchHandler()({
      context: {
        db: async () => db,
      } as unknown as AppRequestContext,
      request,
      params: {
        connectorId: 'github',
        name: 'create_issue',
      },
      pathname: '/api/connections/$connectorId/tools/$name/grant',
      next: () => ({ isNext: true, context: undefined }),
    })

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ ok: true })
    expect(onConflictDoUpdate).toHaveBeenCalledOnce()
  })
})
