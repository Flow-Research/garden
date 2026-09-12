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

function getDeleteHandler() {
  const handlers = Route.options.server?.handlers

  if (!handlers || typeof handlers === 'function') {
    throw new Error('Expected connection grant route handlers')
  }

  const deleteHandler = handlers.DELETE

  if (typeof deleteHandler !== 'function') {
    throw new Error('Expected connection grant DELETE handler')
  }

  return deleteHandler
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
    const insertedValues: unknown[] = []

    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn((rows: unknown) => {
          insertedValues.push(rows)
          return { onConflictDoUpdate }
        }),
      })),
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit,
          })),
        })),
      })),
      transaction: vi.fn(
        async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
          fn(tx),
      ),
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
    expect(insertedValues).toHaveLength(2)
    expect(insertedValues[1]).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        subjectType: 'agent',
        subjectId: agentId,
        actorType: 'user',
        eventType: 'permission.grant.set',
        payload: expect.objectContaining({
          scope: 'tool',
          connector_id: 'github',
          tool_name: 'create_issue',
          trust: 'allow',
        }),
      }),
    )
  })

  it('rejects deleting grants for agents outside the workspace', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValueOnce([]),
          })),
        })),
      })),
    }

    mocks.requireWorkspacePermission.mockResolvedValueOnce(null)

    const response = await getDeleteHandler()({
      context: {
        db: async () => db,
      } as unknown as AppRequestContext,
      request: new Request(
        'https://garden.test/api/connections/github/tools/create_issue/grant',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: '00000000-0000-4000-8000-999999999999',
          }),
        },
      ),
      params: {
        connectorId: 'github',
        name: 'create_issue',
      },
      pathname: '/api/connections/$connectorId/tools/$name/grant',
      next: () => ({ isNext: true, context: undefined }),
    })

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(404)
  })

  it('skips activity when the deleted grant does not exist', async () => {
    const agentId = '00000000-0000-4000-8000-000000000001'
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ id: agentId }])
      .mockResolvedValueOnce([{ id: 'capability-id' }])
    const returning = vi.fn().mockResolvedValueOnce([])
    const txInsert = vi.fn()

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit,
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning,
        })),
      })),
      insert: txInsert,
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValueOnce([{ id: agentId }]),
          })),
        })),
      })),
      transaction: vi.fn(
        async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
          fn(tx),
      ),
    }

    mocks.requireWorkspacePermission.mockResolvedValueOnce(null)

    const response = await getDeleteHandler()({
      context: {
        db: async () => db,
      } as unknown as AppRequestContext,
      request: new Request(
        'https://garden.test/api/connections/github/tools/create_issue/grant',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        },
      ),
      params: {
        connectorId: 'github',
        name: 'create_issue',
      },
      pathname: '/api/connections/$connectorId/tools/$name/grant',
      next: () => ({ isNext: true, context: undefined }),
    })

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(200)
    expect(returning).toHaveBeenCalledOnce()
    expect(txInsert).not.toHaveBeenCalled()
  })
})
