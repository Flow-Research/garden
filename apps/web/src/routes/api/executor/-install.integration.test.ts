import type { AppRequestContext } from '@/lib/server/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './install'

const mocks = vi.hoisted(() => ({
  requireAppRequestContext: vi.fn(),
  requireWorkspaceContext: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  runExecutorRouteEffect: vi.fn(),
}))

vi.mock('@/lib/server/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/context')>()
  return {
    ...actual,
    requireAppRequestContext: mocks.requireAppRequestContext,
  }
})

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/control-plane')>()
  return {
    ...actual,
    requireWorkspaceContext: mocks.requireWorkspaceContext,
  }
})

vi.mock('@/lib/server/workspace-permissions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/workspace-permissions')>()
  return {
    ...actual,
    requireWorkspacePermission: mocks.requireWorkspacePermission,
  }
})

vi.mock('@/lib/server/executor-observability', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/executor-observability')>()
  return {
    ...actual,
    runExecutorRouteEffect: mocks.runExecutorRouteEffect,
  }
})

function getHandler() {
  const handlers = Route.options.server?.handlers
  if (!handlers || typeof handlers === 'function' || !handlers.POST) {
    throw new Error('Expected Executor install POST handler')
  }
  return handlers.POST as (args: {
    context: AppRequestContext
    request: Request
    params: Record<string, string>
    pathname: string
    next: () => { isNext: boolean; context: undefined }
  }) => Promise<Response>
}

function installRequest(owner: 'user' | 'org') {
  return new Request('https://garden.test/api/executor/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: 'executor:decide',
      source: 'mcp',
      owner,
    }),
  })
}

describe('Executor install authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAppRequestContext.mockReturnValue({} as AppRequestContext)
    mocks.requireWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-id',
      session: { user: { id: 'user-id' } },
    })
    mocks.requireWorkspacePermission.mockResolvedValue(null)
    mocks.runExecutorRouteEffect.mockResolvedValue({
      ok: true,
      value: {
        kind: 'oauth_ready',
        slug: 'decide',
        connectUrl: '/api/executor/oauth/start?integration=decide',
      },
    })
  })

  it('allows a Personal install without workspace connection permission', async () => {
    const request = installRequest('user')
    const response = await getHandler()({
      context: {} as AppRequestContext,
      request,
      params: {},
      pathname: '/api/executor/install',
      next: () => ({ isNext: true, context: undefined }),
    })

    expect(response.status).toBe(200)
    expect(mocks.requireWorkspacePermission).not.toHaveBeenCalled()
    expect(mocks.runExecutorRouteEffect).toHaveBeenCalledOnce()
  })

  it('requires connection permission for a Workspace install', async () => {
    const forbidden = Response.json({ error: 'Forbidden' }, { status: 403 })
    mocks.requireWorkspacePermission.mockResolvedValue(forbidden)
    const request = installRequest('org')

    const response = await getHandler()({
      context: {} as AppRequestContext,
      request,
      params: {},
      pathname: '/api/executor/install',
      next: () => ({ isNext: true, context: undefined }),
    })

    expect(response).toBe(forbidden)
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith({
      appContext: expect.anything(),
      request,
      workspaceId: 'workspace-id',
      permissions: { connection: ['update'] },
    })
    expect(mocks.runExecutorRouteEffect).not.toHaveBeenCalled()
  })
})
