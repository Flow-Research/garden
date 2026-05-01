import { describe, expect, it } from 'vitest'
import {
  buildConnectorSyncPlan,
  hasWarmStoredConnectorServers,
  extractThreadIdFromAgentName,
  MCP_PROXY_JWT_REFRESH_WINDOW_MS,
} from './mcp-connectors'
import {
  buildConnectorProxyMcpUrl,
  resolveProxyBaseUrl,
} from './primary-agent-mcp'

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

describe('resolveProxyBaseUrl', () => {
  it('uses an explicit proxy URL when configured', () => {
    expect(
      resolveProxyBaseUrl({
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'http://localhost:3000',
        DATABASE_URL: 'postgres://example',
        MCP_PROXY_URL: 'http://127.0.0.1:9999/',
      }),
    ).toBe('http://127.0.0.1:9999/')
  })

  it('uses the web service-binding route during local web dev', () => {
    expect(
      resolveProxyBaseUrl({
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'http://localhost:3000',
        DATABASE_URL: 'postgres://example',
      }),
    ).toBe('http://localhost:3000/api/mcp-proxy/')
  })

  it('uses the web service-binding route for deployed origins', () => {
    expect(
      resolveProxyBaseUrl({
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.example.com',
        DATABASE_URL: 'postgres://example',
      }),
    ).toBe('https://garden.example.com/api/mcp-proxy/')
  })
})

describe('buildConnectorProxyMcpUrl', () => {
  it('preserves the proxy base path when joining connector routes', () => {
    expect(
      buildConnectorProxyMcpUrl(
        'exa-search',
        'http://localhost:3000/api/mcp-proxy/',
      ),
    ).toBe('http://localhost:3000/api/mcp-proxy/exa-search/mcp')
  })
})
