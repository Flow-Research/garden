// @vitest-environment node
import { Effect } from 'effect'
import { beforeEach, expect, it, vi } from 'vitest'
import { Route, settleOAuthCallback } from './callback'
import type { AppRequestContext } from '@/lib/server/context'

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  pendingOAuthOwner: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  syncCapabilities: vi.fn(),
  mirrorExecutorConnection: vi.fn(),
}))

vi.mock('@/lib/server/control-plane', () => ({
  requireWorkspaceContext: async () => ({
    workspaceId: 'workspace-a',
    session: { user: { id: 'actor-a' } },
  }),
  requireWorkspaceAccess: async () => ({
    session: { user: { id: 'actor-a' } },
  }),
}))
vi.mock('@/lib/server/executor-engine/d1', () => ({
  pendingOAuthOwner: mocks.pendingOAuthOwner,
}))
vi.mock('@/lib/server/workspace-permissions', () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
  workspacePermissions: { connectionManage: 'manage' },
}))
vi.mock('@/lib/server/executor-runtime', () => ({
  executorProgram: (
    _identity: unknown,
    runWithExecutor: (executor: unknown) => unknown,
  ) => runWithExecutor({ oauth: { complete: mocks.complete } }),
}))
vi.mock('@/lib/server/capability-sync', () => ({
  syncCapabilities: mocks.syncCapabilities,
}))
vi.mock('@/lib/server/executor-engine/connection-mirror', () => ({
  mirrorExecutorConnection: mocks.mirrorExecutorConnection,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.complete.mockReturnValue(
    Effect.succeed({
      owner: 'org',
      integration: 'google_drive',
      name: 'company',
    }),
  )
  mocks.syncCapabilities.mockReturnValue(Effect.succeed(undefined))
})

it('syncs an org OAuth connection with the verified actor and no user mirror', async () => {
  const result = await Effect.runPromise(
    settleOAuthCallback({
      identity: { tenant: 'workspace-a', subject: 'admin-a' },
      state: 'state',
      code: 'code',
      providerError: null,
      providerErrorDescription: null,
    }),
  )

  expect(result).toEqual({ ok: true })
  expect(mocks.syncCapabilities).toHaveBeenCalledWith(
    'google-drive',
    'admin-a',
    'workspace-a',
  )
  expect(mocks.mirrorExecutorConnection).not.toHaveBeenCalled()
})

it('keeps the completed org connection when its tools need a resync', async () => {
  mocks.syncCapabilities.mockReturnValue(
    Effect.fail(new Error('Catalog unavailable')),
  )
  const result = await Effect.runPromise(
    settleOAuthCallback({
      identity: { tenant: 'workspace-a', subject: 'admin-a' },
      state: 'state',
      code: 'code',
      providerError: null,
      providerErrorDescription: null,
    }),
  )
  expect(result).toEqual({
    ok: true,
    warning: expect.stringContaining('Resync'),
  })
  expect(mocks.complete).toHaveBeenCalledOnce()
})

it.each(['code=local', 'error=cancelled'])(
  'checks organization permission before settling a callback (%s)',
  async (query) => {
    mocks.pendingOAuthOwner.mockReturnValue(Effect.succeed('org'))
    mocks.requireWorkspacePermission.mockResolvedValue(
      new Response('Forbidden', { status: 403 }),
    )
    const handler = Route.options.server?.handlers
    if (!handler || typeof handler === 'function' || !handler.GET)
      throw new Error('Missing callback GET')
    const request = new Request(
      `https://garden.test/api/oauth/callback?state=pending&${query}`,
    )
    const get = handler.GET as (args: {
      context: AppRequestContext
      request: Request
    }) => Promise<Response>
    const response = await get({
      request,
      context: { env: {} } as AppRequestContext,
    })
    expect(response.status).toBe(403)
    expect(mocks.pendingOAuthOwner).toHaveBeenCalledOnce()
    expect(mocks.complete).not.toHaveBeenCalled()
  },
)
