import { Result } from 'better-result'
import { GitHubAppAuthError } from '@garden/connectors/github-app'
import type { AppRequestContext } from '@/lib/server/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './install'
import { invokeRouteHandler } from '@/test/route-handler'

const mocks = vi.hoisted(() => ({
  getGitHubAppInstallation: vi.fn(),
  createGitHubSetupState: vi.fn(async () => 'signed-state'),
  requireSession: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  requireWorkspacePermission: vi.fn(),
}))

vi.mock('@garden/connectors/github-app', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@garden/connectors/github-app')>()
  return {
    ...actual,
    getGitHubAppInstallation: mocks.getGitHubAppInstallation,
  }
})

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/control-plane')>()
  return {
    ...actual,
    requireSession: mocks.requireSession,
    resolveWorkspaceId: mocks.resolveWorkspaceId,
  }
})

vi.mock('@/lib/server/env', () => ({
  appEnv: {
    BETTER_AUTH_SECRET: 'test-secret',
    GITHUB_APP_ID: '3547700',
    GITHUB_APP_PRIVATE_KEY: 'test-private-key',
    GITHUB_APP_SLUG: 'garden-ai-dev',
  },
}))

vi.mock('@/lib/server/workspace-permissions', () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
  workspacePermissions: {
    connectionManage: { connection: ['update'] },
  },
}))

vi.mock('@/lib/server/github-app', () => ({
  buildGitHubAppInstallUrl: ({
    appSlug,
    state,
  }: {
    appSlug: string
    state: string
  }) => `https://github.com/apps/${appSlug}/installations/new?state=${state}`,
  createGitHubSetupState: mocks.createGitHubSetupState,
  normalizeGitHubAppEnv: (env: unknown) => env,
  resolveGitHubAppSlug: () => 'garden-ai-dev',
}))

describe('GitHub install recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireSession.mockResolvedValue({ user: { id: 'user-id' } })
    mocks.resolveWorkspaceId.mockResolvedValue('workspace-id')
    mocks.requireWorkspacePermission.mockResolvedValue(null)
  })

  it('refuses installation changes without connection management permission', async () => {
    const forbidden = Response.json({ error: 'Forbidden' }, { status: 403 })
    const db = {
      select: vi.fn(),
      update: vi.fn(),
    }
    mocks.requireWorkspacePermission.mockResolvedValue(forbidden)

    const request = new Request(
      'https://garden.test/api/github/install?connector_flow=flow-id',
    )
    const response = await invokeRouteHandler(Route, 'GET', {
      context: { db: async () => db } as unknown as AppRequestContext,
      request,
      params: {},
    })

    expect(response).toBe(forbidden)
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith({
      appContext: expect.anything(),
      request,
      workspaceId: 'workspace-id',
      permissions: { connection: ['update'] },
    })
    expect(db.select).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
    expect(mocks.getGitHubAppInstallation).not.toHaveBeenCalled()
    expect(mocks.createGitHubSetupState).not.toHaveBeenCalled()
  })

  it('marks a stale connected row degraded and starts a signed repair flow', async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([
        { id: 'installation-row-id', installationId: 'old-installation-id' },
      ])
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    }
    mocks.getGitHubAppInstallation.mockResolvedValue(
      Result.err(
        new GitHubAppAuthError({
          code: 'token_request_failed',
          status: 404,
          message: 'Not Found',
        }),
      ),
    )

    const request = new Request(
      'https://garden.test/api/github/install?connector_flow=flow-id',
    )
    const response = await invokeRouteHandler(Route, 'GET', {
      context: { db: async () => db } as unknown as AppRequestContext,
      request,
      params: {},
    })

    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe(
      'https://github.com/apps/garden-ai-dev/installations/new?state=signed-state',
    )
    expect(db.update).toHaveBeenCalledOnce()
    expect(updateWhere).toHaveBeenCalledOnce()
  })

  it('preserves a connected row when GitHub verification temporarily fails', async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([
        { id: 'installation-row-id', installationId: 'installation-id' },
      ])
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
      update: vi.fn(),
    }
    mocks.getGitHubAppInstallation.mockResolvedValue(
      Result.err(
        new GitHubAppAuthError({
          code: 'token_request_failed',
          status: 503,
          message: 'Service Unavailable',
        }),
      ),
    )

    const request = new Request(
      'https://garden.test/api/github/install?connector_flow=flow-id',
    )
    const response = await invokeRouteHandler(Route, 'GET', {
      context: { db: async () => db } as unknown as AppRequestContext,
      request,
      params: {},
    })

    expect(response?.status).toBe(502)
    await expect(response?.json()).resolves.toEqual({
      error: 'Unable to verify the GitHub installation. Try again.',
    })
    expect(db.update).not.toHaveBeenCalled()
    expect(mocks.createGitHubSetupState).not.toHaveBeenCalled()
  })
})
