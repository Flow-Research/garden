import type { AppRequestContext } from '@/lib/server/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './grant'

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  capturePostHogEvent: vi.fn(),
  getConnectorById: vi.fn(),
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

vi.mock('@garden/connectors', () => ({
  getConnectorById: mocks.getConnectorById,
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

function grantRequest(body: unknown) {
  return new Request('https://garden.test/api/connections/github/grant', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function invokePatch(request: Request) {
  return getPatchHandler()({
    context: {} as AppRequestContext,
    request,
    params: { connectorId: 'github' },
    pathname: '/api/connections/$connectorId/grant',
    next: () => ({ isNext: true, context: undefined }),
  })
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
    mocks.getConnectorById.mockReturnValue({ id: 'github' })
  })

  it('rejects members without permissionManage before parsing the grant', async () => {
    const request = grantRequest('invalid-json')

    const response = await invokePatch(request)

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

  it('rejects unknown connectors', async () => {
    mocks.requireWorkspacePermission.mockResolvedValueOnce(null)
    mocks.getConnectorById.mockReturnValueOnce(undefined)

    const response = await invokePatch(
      grantRequest({
        agentId: '00000000-0000-4000-8000-000000000001',
        trustLevel: 'allow',
      }),
    )

    expect(response?.status).toBe(404)
  })

  it('rejects auto trust at connection scope', async () => {
    mocks.requireWorkspacePermission.mockResolvedValueOnce(null)

    const response = await invokePatch(
      grantRequest({
        agentId: '00000000-0000-4000-8000-000000000001',
        trustLevel: 'auto',
      }),
    )

    expect(response?.status).toBe(400)
  })

  it('upserts the connection grant for permitted members', async () => {
    const agentId = '00000000-0000-4000-8000-000000000001'

    const limit = vi.fn().mockResolvedValueOnce([{ id: agentId }])
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

    const response = await getPatchHandler()({
      context: {
        db: async () => db,
      } as unknown as AppRequestContext,
      request: grantRequest({ agentId, trustLevel: 'allow' }),
      params: { connectorId: 'github' },
      pathname: '/api/connections/$connectorId/grant',
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
          scope: 'connection',
          connector_id: 'github',
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
      request: grantRequest({
        agentId: '00000000-0000-4000-8000-999999999999',
      }),
      params: { connectorId: 'github' },
      pathname: '/api/connections/$connectorId/grant',
      next: () => ({ isNext: true, context: undefined }),
    })

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(404)
  })
})
