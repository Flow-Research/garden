import { describe, expect, it } from 'vitest'
import {
  buildConnectorSyncPlan,
  hasWarmStoredConnectorServers,
  extractThreadIdFromAgentName,
  MCP_PROXY_JWT_REFRESH_WINDOW_MS,
} from './mcp-connectors'
import {
  connectRpcMcpConnector,
  isMcpDiscoveryCancellation,
  type RpcMcpConnectorProps,
} from './runtime-mcp-controller'

describe('extractThreadIdFromAgentName', () => {
  it('extracts the thread id from chat agent names', () => {
    expect(extractThreadIdFromAgentName('chat:thread-123')).toBe('thread-123')
  })

  it('returns null for blank names', () => {
    expect(extractThreadIdFromAgentName('   ')).toBeNull()
  })
})

describe('buildConnectorSyncPlan', () => {
  it('refreshes bindings that are missing from storage', () => {
    const plan = buildConnectorSyncPlan({
      bindings: [{ connectorId: 'github', accountId: 'account-1' }],
      storedRows: [],
      now: Date.UTC(2026, 3, 23, 10, 0, 0),
    })

    expect(plan.connectorIdsToRemove).toEqual([])
    expect(plan.bindingsToRefresh).toEqual([
      { connectorId: 'github', accountId: 'account-1' },
    ])
  })

  it('removes stale stored connectors and keeps fresh ones', () => {
    const now = Date.UTC(2026, 3, 23, 10, 0, 0)
    const future = new Date(
      now + MCP_PROXY_JWT_REFRESH_WINDOW_MS + 5 * 60 * 1000,
    ).toISOString()

    const plan = buildConnectorSyncPlan({
      bindings: [{ connectorId: 'gmail', accountId: 'account-2' }],
      storedRows: [
        {
          connectorId: 'gmail',
          serverId: 'gmail',
          accountId: 'account-2',
          jwtExpiresAt: future,
          toolsSignature: null,
        },
        {
          connectorId: 'slack',
          serverId: 'slack',
          accountId: 'account-3',
          jwtExpiresAt: future,
          toolsSignature: null,
        },
      ],
      now,
    })

    expect(plan.connectorIdsToRemove).toEqual(['slack'])
    expect(plan.bindingsToRefresh).toEqual([])
  })

  it('refreshes stored bindings whose server is not registered in memory', () => {
    const now = Date.UTC(2026, 3, 23, 10, 0, 0)
    const future = new Date(
      now + MCP_PROXY_JWT_REFRESH_WINDOW_MS + 5 * 60 * 1000,
    ).toISOString()

    const plan = buildConnectorSyncPlan({
      bindings: [{ connectorId: 'exa-search', accountId: null }],
      registeredServerIds: [],
      storedRows: [
        {
          connectorId: 'exa-search',
          serverId: 'exa-search',
          accountId: null,
          jwtExpiresAt: future,
          toolsSignature: null,
        },
      ],
      now,
    })

    expect(plan.connectorIdsToRemove).toEqual([])
    expect(plan.bindingsToRefresh).toEqual([
      { connectorId: 'exa-search', accountId: null },
    ])
  })

  it('refreshes bindings whose jwt is near expiry or account changed', () => {
    const now = Date.UTC(2026, 3, 23, 10, 0, 0)
    const nearExpiry = new Date(
      now + MCP_PROXY_JWT_REFRESH_WINDOW_MS - 1_000,
    ).toISOString()

    const plan = buildConnectorSyncPlan({
      bindings: [
        { connectorId: 'google-drive', accountId: 'account-4' },
        { connectorId: 'exa-search', accountId: null },
      ],
      storedRows: [
        {
          connectorId: 'google-drive',
          serverId: 'google-drive',
          accountId: 'old-account',
          jwtExpiresAt: nearExpiry,
          toolsSignature: null,
        },
        {
          connectorId: 'exa-search',
          serverId: 'exa-search',
          accountId: null,
          jwtExpiresAt: nearExpiry,
          toolsSignature: null,
        },
      ],
      now,
    })

    expect(plan.connectorIdsToRemove).toEqual([])
    expect(plan.bindingsToRefresh).toEqual([
      { connectorId: 'google-drive', accountId: 'account-4' },
      { connectorId: 'exa-search', accountId: null },
    ])
  })
})

describe('hasWarmStoredConnectorServers', () => {
  it('returns true when every stored connector is registered and unexpired', () => {
    const now = Date.UTC(2026, 3, 23, 10, 0, 0)
    const future = new Date(
      now + MCP_PROXY_JWT_REFRESH_WINDOW_MS + 5 * 60 * 1000,
    ).toISOString()

    expect(
      hasWarmStoredConnectorServers({
        registeredServerIds: ['github', 'exa-search'],
        storedRows: [
          {
            connectorId: 'github',
            serverId: 'github',
            accountId: 'account-1',
            jwtExpiresAt: future,
            toolsSignature: null,
          },
          {
            connectorId: 'exa-search',
            serverId: 'exa-search',
            accountId: null,
            jwtExpiresAt: future,
            toolsSignature: null,
          },
        ],
        now,
      }),
    ).toBe(true)
  })

  it('returns false when storage is empty, missing a server, or near expiry', () => {
    const now = Date.UTC(2026, 3, 23, 10, 0, 0)
    const future = new Date(
      now + MCP_PROXY_JWT_REFRESH_WINDOW_MS + 5 * 60 * 1000,
    ).toISOString()
    const nearExpiry = new Date(
      now + MCP_PROXY_JWT_REFRESH_WINDOW_MS,
    ).toISOString()

    expect(
      hasWarmStoredConnectorServers({
        registeredServerIds: ['github'],
        storedRows: [],
        now,
      }),
    ).toBe(false)

    expect(
      hasWarmStoredConnectorServers({
        registeredServerIds: [],
        storedRows: [
          {
            connectorId: 'github',
            serverId: 'github',
            accountId: 'account-1',
            jwtExpiresAt: future,
            toolsSignature: null,
          },
        ],
        now,
      }),
    ).toBe(false)

    expect(
      hasWarmStoredConnectorServers({
        registeredServerIds: ['github'],
        storedRows: [
          {
            connectorId: 'github',
            serverId: 'github',
            accountId: 'account-1',
            jwtExpiresAt: nearExpiry,
            toolsSignature: null,
          },
        ],
        now,
      }),
    ).toBe(false)
  })
})

describe('isMcpDiscoveryCancellation', () => {
  it('matches the Agents MCP cancellation message exactly', () => {
    expect(isMcpDiscoveryCancellation('Discovery was cancelled')).toBe(true)
    expect(isMcpDiscoveryCancellation('Network connection lost.')).toBe(false)
    expect(isMcpDiscoveryCancellation(undefined)).toBe(false)
  })
})

describe('connectRpcMcpConnector', () => {
  it('connects with RPC transport, stable reconnect id, namespace, and props', async () => {
    const calls: unknown[] = []
    const namespace = { binding: 'MCP_SESSION' } as unknown as DurableObjectNamespace
    const props = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      connectorId: 'github',
      authKind: 'oauth',
    } satisfies RpcMcpConnectorProps

    const result = await connectRpcMcpConnector({
      mcp: {
        connect: async (...args: unknown[]) => {
          calls.push(args)
          return { id: 'github' }
        },
      },
      namespace,
      connectorId: 'github',
      props,
    })

    expect(result).toEqual({ state: 'connected' })
    expect(calls).toEqual([
      [
        'rpc://github',
        {
          reconnect: { id: 'github' },
          transport: {
            type: 'rpc',
            namespace,
            name: 'github',
            props,
          },
        },
      ],
    ])
  })

  it('fails when the MCP client returns an unexpected reconnect id', async () => {
    const result = await connectRpcMcpConnector({
      mcp: {
        connect: async () => ({ id: 'wrong-id' }),
      },
      namespace: {} as DurableObjectNamespace,
      connectorId: 'github',
      props: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        connectorId: 'github',
        authKind: 'oauth',
      },
    })

    expect(result).toEqual({
      state: 'failed',
      error: 'RPC MCP id mismatch',
    })
  })
})
