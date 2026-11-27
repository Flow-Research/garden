import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectIntegration, type RegistryEntry } from './executor'
import { configureApi } from './state'

const entry = {
  providerId: 'executor:decide',
} as RegistryEntry

describe('Executor API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends personal ownership with an install request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        kind: 'oauth_ready',
        slug: 'decide',
        connectUrl: '/api/executor/oauth/start?integration=decide',
      }),
    )
    const transport = configureApi('https://garden.test')
    transport.setWorkspaceId('workspace-1')

    await connectIntegration({ entry, source: 'mcp', owner: 'user' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://garden.test/api/executor/install',
      expect.objectContaining({
        body: JSON.stringify({
          providerId: 'executor:decide',
          source: 'mcp',
          owner: 'user',
        }),
        credentials: 'include',
      }),
    )
  })
})
