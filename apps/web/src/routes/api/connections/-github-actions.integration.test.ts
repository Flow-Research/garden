import type { AppRequestContext } from '@/lib/server/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './$connectorId'
import { invokeRouteHandler } from '@/test/route-handler'

const mocks = vi.hoisted(() => ({
  capturePostHogEvent: vi.fn(),
  deleteGitHubAppInstallation: vi.fn(),
  requireWorkspaceContext: vi.fn(),
  requireWorkspacePermission: vi.fn(),
}))

vi.mock('@garden/connectors/github-app', () => ({
  deleteGitHubAppInstallation: mocks.deleteGitHubAppInstallation,
  getGitHubAppInstallation: vi.fn(),
}))

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/control-plane')>()
  return {
    ...actual,
    requireWorkspaceContext: mocks.requireWorkspaceContext,
  }
})

vi.mock('@/lib/server/workspace-permissions', () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
  workspacePermissions: {
    connectionManage: { connection: ['manage'] },
  },
}))

vi.mock('@/lib/posthog-server', () => ({
  capturePostHogEvent: mocks.capturePostHogEvent,
}))

vi.mock('@/lib/server/env', () => ({ appEnv: {} }))

describe('GitHub connection actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-id',
      session: { user: { id: 'user-id' } },
    })
    mocks.requireWorkspacePermission.mockResolvedValue(null)
  })

  it('disconnects the workspace binding without uninstalling the organization app', async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([
        { installationId: '155955068', accountLogin: 'Flow-Research' },
      ])
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
      delete: vi.fn(() => ({ where: deleteWhere })),
    }
    const request = new Request('https://garden.test/api/connections/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' }),
    })

    const response = await invokeRouteHandler(Route, 'POST', {
      context: { db: async () => db } as unknown as AppRequestContext,
      request,
      params: { connectorId: 'github' },
    })

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ ok: true })
    expect(mocks.deleteGitHubAppInstallation).not.toHaveBeenCalled()
    expect(deleteWhere).toHaveBeenCalledOnce()
  })
})
