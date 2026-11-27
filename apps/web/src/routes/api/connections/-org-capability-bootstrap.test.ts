// @vitest-environment node
import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppRequestContext } from '@/lib/server/context'
import { Route } from './$connectorId'

const mocks = vi.hoisted(() => ({
  requireWorkspaceContext: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  runExecutor: vi.fn(),
  syncCapabilities: vi.fn(),
  mirrorExecutorConnection: vi.fn(),
  capturePostHogEvent: vi.fn(),
}))

vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: () => ({}),
}))
vi.mock('@/lib/server/control-plane', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/control-plane')>()),
  requireWorkspaceContext: mocks.requireWorkspaceContext,
}))
vi.mock('@/lib/server/workspace-permissions', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/workspace-permissions')
  >()),
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}))
vi.mock('@/lib/server/executor-runtime', () => ({
  runExecutor: mocks.runExecutor,
}))
vi.mock('@/lib/server/capability-sync', () => ({
  syncCapabilities: mocks.syncCapabilities,
}))
vi.mock('@/lib/server/executor-engine/connection-mirror', () => ({
  mirrorExecutorConnection: mocks.mirrorExecutorConnection,
  markMirrorDegraded: vi.fn(),
  unmirrorExecutorConnection: vi.fn(),
}))
vi.mock('@/lib/posthog-server', () => ({
  capturePostHogEvent: mocks.capturePostHogEvent,
}))

function handler(method: 'PUT' | 'POST') {
  const handlers = Route.options.server?.handlers
  if (!handlers || typeof handlers === 'function' || !handlers[method]) {
    throw new Error(`Expected connection ${method} handler`)
  }
  return handlers[method] as (args: {
    context: AppRequestContext
    request: Request
    params: { connectorId: string }
    pathname: string
    next: () => { isNext: boolean; context: undefined }
  }) => Promise<Response>
}

function call(method: 'PUT' | 'POST', body: object) {
  return handler(method)({
    context: {} as AppRequestContext,
    request: new Request('https://garden.test/api/connections/google_drive', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: { connectorId: 'google_drive' },
    pathname: '/api/connections/google_drive',
    next: () => ({ isNext: true, context: undefined }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireWorkspaceContext.mockResolvedValue({
    workspaceId: 'workspace-a',
    session: { user: { id: 'admin-a' } },
  })
  mocks.requireWorkspacePermission.mockResolvedValue(null)
  mocks.syncCapabilities.mockReturnValue(Effect.succeed(undefined))
})

describe('org connection capability bootstrap', () => {
  it('syncs after a credential connection is created and refreshed', async () => {
    const connection = {
      owner: 'org',
      integration: 'google_drive',
      address: 'connections.google_drive.org.company',
    }
    const create = vi.fn(() => Effect.succeed(connection))
    const refresh = vi.fn(() => Effect.succeed([{}]))
    const executor = {
      integrations: {
        get: () =>
          Effect.succeed({
            slug: 'google_drive',
            authMethods: [
              {
                kind: 'apikey',
                template: 'api-key',
                placements: [{ variable: 'token' }],
              },
            ],
          }),
      },
      connections: { create, refresh },
    }
    mocks.runExecutor.mockImplementation(
      (
        _identity: unknown,
        runWithExecutor: (value: typeof executor) => Effect.Effect<unknown>,
      ) => Effect.runPromise(runWithExecutor(executor)),
    )

    const response = await call('PUT', {
      owner: 'org',
      name: 'company',
      template: 'api-key',
      values: { token: 'fixture' },
    })

    expect(response.status).toBe(200)
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledOnce()
    expect(mocks.syncCapabilities).toHaveBeenCalledWith(
      'google-drive',
      'admin-a',
      'workspace-a',
    )
    expect(mocks.mirrorExecutorConnection).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'org', integration: 'google_drive' }),
    )
    expect(refresh).toHaveBeenCalledOnce()
  })

  it.each(['connect', 'resync'])('syncs after %s', async (action) => {
    const connection = {
      owner: 'org',
      integration: 'google_drive',
      name: 'company',
      lastHealth: { status: 'healthy' },
    }
    const create = vi.fn(() => Effect.succeed(connection))
    const refresh = vi.fn(() => Effect.succeed([]))
    const executor = {
      integrations: {
        get: () =>
          Effect.succeed({
            slug: 'google_drive',
            authMethods: [{ kind: 'none', template: 'none' }],
            canRefresh: true,
          }),
      },
      connections: {
        list: () => Effect.succeed(action === 'connect' ? [] : [connection]),
        create,
        refresh,
      },
    }
    mocks.runExecutor.mockImplementation(
      (
        _identity: unknown,
        runWithExecutor: (value: typeof executor) => Effect.Effect<unknown>,
      ) => Effect.runPromise(runWithExecutor(executor)),
    )

    const response = await call('POST', { action })

    expect(response.status).toBe(200)
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledOnce()
    expect(mocks.syncCapabilities).toHaveBeenCalledWith(
      'google-drive',
      'admin-a',
      'workspace-a',
    )
    expect(mocks.mirrorExecutorConnection).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledTimes(action === 'connect' ? 1 : 0)
  })

  it('refuses org connect before Executor or catalog writes', async () => {
    const executor = {
      integrations: {
        get: () =>
          Effect.succeed({
            slug: 'google_drive',
            authMethods: [{ kind: 'none', template: 'none' }],
            canRefresh: false,
          }),
      },
      connections: {
        list: () => Effect.succeed([]),
        create: vi.fn(),
      },
    }
    mocks.runExecutor.mockImplementation(
      (
        _identity: unknown,
        runWithExecutor: (value: typeof executor) => Effect.Effect<unknown>,
      ) => Effect.runPromise(runWithExecutor(executor)),
    )
    mocks.requireWorkspacePermission.mockResolvedValue(
      Response.json({ error: 'Forbidden' }, { status: 403 }),
    )

    const response = await call('POST', { action: 'connect' })

    expect(response.status).toBe(403)
    expect(mocks.syncCapabilities).not.toHaveBeenCalled()
  })
})
