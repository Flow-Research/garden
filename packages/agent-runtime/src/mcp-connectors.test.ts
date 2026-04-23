import { describe, expect, it } from 'vitest'
import {
  buildConnectorSyncPlan,
  extractThreadIdFromAgentName,
  MCP_PROXY_JWT_REFRESH_WINDOW_MS,
} from './mcp-connectors'

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
