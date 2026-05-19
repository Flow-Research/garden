import { describe, expect, it } from 'vitest'
import { Result } from 'better-result'
import type { ToolSet } from 'ai'
import type { MCPServerFilter } from 'agents/mcp/client'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import {
  buildConnectorSyncPlan,
  hasWarmStoredConnectorServers,
  extractThreadIdFromAgentName,
  MCP_PROXY_JWT_REFRESH_WINDOW_MS,
  type StoredConnectorServerRow,
} from './mcp-connectors'
import {
  isMcpFailedConnectionStateMessage,
  isMcpDiscoveryCancellation,
  RuntimeMcpController,
  RuntimeMcpConnectionPreparer,
  RuntimeMcpError,
  type McpHost,
  type McpToolRecord,
} from './runtime-mcp-controller'

function createSqlStorageStub(initialRows: StoredConnectorServerRow[] = []) {
  const rows = new Map<string, Record<string, unknown>>()

  for (const row of initialRows) {
    rows.set(row.connectorId, {
      connector_id: row.connectorId,
      server_id: row.serverId,
      account_id: row.accountId,
      workspace_id: 'workspace-1',
      user_id: 'user-1',
      agent_id: 'agent-1',
      jwt_expires_at: row.jwtExpiresAt,
      tools_signature: row.toolsSignature,
    })
  }

  return {
    exec(sql: string, ...params: unknown[]) {
      const normalized = sql.trim().toLowerCase()

      if (normalized.startsWith('select')) {
        return rows.values()
      }

      if (normalized.startsWith('insert into mcp_connector_server')) {
        const [
          connectorId,
          serverId,
          accountId,
          workspaceId,
          userId,
          agentId,
          jwtExpiresAt,
          toolsSignature,
        ] = params

        rows.set(String(connectorId), {
          connector_id: connectorId,
          server_id: serverId,
          account_id: accountId,
          workspace_id: workspaceId,
          user_id: userId,
          agent_id: agentId,
          jwt_expires_at: jwtExpiresAt,
          tools_signature: toolsSignature,
        })

        return []
      }

      if (normalized.startsWith('delete from mcp_connector_server')) {
        rows.delete(String(params[0]))
        return []
      }

      if (normalized.startsWith('update mcp_connector_server')) {
        const row = rows.get(String(params[2]))
        if (row) row.tools_signature = params[0]
        return []
      }

      return []
    },
  } as unknown as SqlStorage
}

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

describe('isMcpFailedConnectionStateMessage', () => {
  it('matches Agents SDK failed-state discovery errors', () => {
    expect(
      isMcpFailedConnectionStateMessage(
        'Failed to discover server capabilities: Discovery skipped - connection in failed state',
      ),
    ).toBe(true)
    expect(isMcpFailedConnectionStateMessage('No tools discovered')).toBe(false)
    expect(isMcpFailedConnectionStateMessage(undefined)).toBe(false)
  })
})

describe('RuntimeMcpController GitHub tools', () => {
  it('exposes github tools to the agent after the runtime connector is attached', async () => {
    const githubTools: McpToolRecord[] = [
      {
        serverId: 'github',
        name: 'issue_read',
        description: 'Read a GitHub issue.',
        inputSchema: { type: 'object' },
      },
      {
        serverId: 'github',
        name: 'create_pull_request',
        description: 'Create a GitHub pull request.',
        inputSchema: { type: 'object' },
      },
    ]
    const servers: Array<{ id: string; name: string; server_url: string }> = []
    const toolsByServer = new Map<string, McpToolRecord[]>()
    const connectCalls: Array<{
      userId: string
      workspaceId: string
      agentId: string
      connectorId: string
      authKind: 'oauth' | 'api-key' | 'none'
    }> = []
    const listTools = (filter?: MCPServerFilter) => {
      const serverId = filter?.serverId
      const tools = [...toolsByServer.values()].flat()

      if (Array.isArray(serverId)) {
        const serverIds = new Set(serverId)
        return tools.filter((tool) => serverIds.has(tool.serverId))
      }

      return serverId ? (toolsByServer.get(serverId) ?? []) : tools
    }

    const mcp = {
      getAITools: (filter?: MCPServerFilter) =>
        Object.fromEntries(
          listTools(filter).map((tool) => [
            buildMcpAiToolKey(tool.serverId, tool.name),
            {
              description: tool.description,
              inputSchema: { type: 'object' },
            },
          ]),
        ) as unknown as ToolSet,
      listTools,
      listServers: () => servers,
      waitForConnections: async () => undefined,
      discoverIfConnected: async (serverId: string) =>
        toolsByServer.get(serverId)?.length
          ? { success: true }
          : { success: false, error: 'No tools discovered' },
    }

    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp,
      addRpcMcpServer: async ({ connectorId, props }) => {
        const sdkServerId = 'sdk-generated-github'
        connectCalls.push(props)
        servers.push({
          id: sdkServerId,
          name: connectorId,
          server_url: `rpc:${connectorId}`,
        })
        toolsByServer.set(
          sdkServerId,
          githubTools.map((tool) => ({ ...tool, serverId: sdkServerId })),
        )
        return { id: sdkServerId, state: 'connected' }
      },
      removeMcpServer: async (connectorId) => {
        const index = servers.findIndex((server) => server.id === connectorId)
        if (index >= 0) servers.splice(index, 1)
        toolsByServer.delete(connectorId)
      },
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    }
    const controller = new RuntimeMcpController(host)
    ;(
      controller as unknown as {
        listActiveConnectorBindings: () => Promise<
          Result<
            Array<{ connectorId: string; accountId: string | null }>,
            never
          >
        >
      }
    ).listActiveConnectorBindings = async () =>
      Result.ok([{ connectorId: 'github', accountId: null }])

    const result = await controller.ensureProxyMcpConnections()

    expect(result.isOk()).toBe(true)
    expect(connectCalls).toEqual([
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        connectorId: 'github',
        authKind: 'oauth',
      },
    ])
    expect(
      host.mcp
        .listTools({ serverId: 'sdk-generated-github' })
        .map((tool) => tool.name),
    ).toEqual(['issue_read', 'create_pull_request'])

    const aiTools = controller.wrapGetAITools(host.mcp.getAITools)
    expect(Object.keys(aiTools).sort()).toEqual(
      [
        buildMcpAiToolKey('github', 'create_pull_request'),
        buildMcpAiToolKey('github', 'issue_read'),
      ].sort(),
    )
    expect(
      aiTools[buildMcpAiToolKey('github', 'create_pull_request')]?.description,
    ).toContain('External github write tool')

    expect(
      controller.activeToolKeysWithoutRawMcp({
        assembledTools: {
          local_tool: {} as ToolSet[string],
          [buildMcpAiToolKey('sdk-generated-github', 'create_pull_request')]:
            {} as ToolSet[string],
        },
        stableMcpTools: aiTools,
      }),
    ).toEqual([
      'local_tool',
      buildMcpAiToolKey('github', 'issue_read'),
      buildMcpAiToolKey('github', 'create_pull_request'),
    ])
  })

  it('returns connector tool transport failures as tool output instead of throwing', async () => {
    const toolKey = buildMcpAiToolKey('exa-search', 'web_search_exa')
    const controller = new RuntimeMcpController({
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () =>
          ({
            [toolKey]: {
              description: 'Search with Exa.',
              inputSchema: { type: 'object' },
              execute: async () => {
                return await Promise.reject(
                  new Error(
                    'Request timeout: No response received within 120000ms',
                  ),
                )
              },
            },
          }) as unknown as ToolSet,
        listTools: () => [
          {
            serverId: 'exa-search',
            name: 'web_search_exa',
            description: 'Search with Exa.',
            inputSchema: { type: 'object' },
          },
        ],
        listServers: () => [],
        waitForConnections: async () => undefined,
        discoverIfConnected: async () => ({ success: true }),
      },
      addRpcMcpServer: async () => ({ state: 'connected' }),
      removeMcpServer: async () => undefined,
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    })

    const aiTools = controller.wrapGetAITools(
      () =>
        ({
          [toolKey]: {
            description: 'Search with Exa.',
            inputSchema: { type: 'object' },
            execute: async () => {
              return await Promise.reject(
                new Error(
                  'Request timeout: No response received within 120000ms',
                ),
              )
            },
          },
        }) as unknown as ToolSet,
    )
    await expect(
      aiTools[toolKey]?.execute?.({} as never, {} as never),
    ).resolves.toEqual({
      error: true,
      message:
        'exa-search.web_search_exa failed: Request timeout: No response received within 120000ms',
    })
  })

  it('replaces restored http connector servers before checking warm state', async () => {
    const now = Date.UTC(2026, 4, 9, 14, 30, 0)
    const servers: Array<{ id: string; server_url?: string }> = [
      {
        id: 'github',
        server_url: 'http://localhost:3000/api/mcp-proxy/github/mcp',
      },
    ]
    const toolsByServer = new Map<string, McpToolRecord[]>()
    const removedServerIds: string[] = []
    const connectedServerIds: string[] = []
    const githubTools: McpToolRecord[] = [
      {
        serverId: 'github',
        name: 'issue_read',
        description: 'Read a GitHub issue.',
        inputSchema: { type: 'object' },
      },
    ]
    const listTools = (filter?: MCPServerFilter) => {
      const serverId = filter?.serverId
      if (Array.isArray(serverId)) {
        const serverIds = new Set(serverId)
        return [...toolsByServer.values()]
          .flat()
          .filter((tool) => serverIds.has(tool.serverId))
      }

      return serverId
        ? (toolsByServer.get(serverId) ?? [])
        : [...toolsByServer.values()].flat()
    }

    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: {
        storage: {
          sql: createSqlStorageStub([
            {
              connectorId: 'github',
              serverId: 'github',
              accountId: null,
              jwtExpiresAt: new Date(
                now + MCP_PROXY_JWT_REFRESH_WINDOW_MS + 60_000,
              ).toISOString(),
              toolsSignature: null,
            },
          ]),
        },
      },
      mcp: {
        getAITools: () => ({}),
        listTools,
        listServers: () => servers,
        waitForConnections: async () => undefined,
        discoverIfConnected: async (serverId: string) =>
          toolsByServer.get(serverId)?.length
            ? { success: true }
            : { success: false, error: 'No tools discovered' },
      },
      addRpcMcpServer: async ({ connectorId }) => {
        connectedServerIds.push(connectorId)
        servers.push({ id: connectorId, server_url: `rpc:${connectorId}` })
        toolsByServer.set(connectorId, githubTools)
        return { state: 'connected' }
      },
      removeMcpServer: async (connectorId) => {
        removedServerIds.push(connectorId)
        const index = servers.findIndex((server) => server.id === connectorId)
        if (index >= 0) servers.splice(index, 1)
        toolsByServer.delete(connectorId)
      },
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    }
    const controller = new RuntimeMcpController(host)
    ;(
      controller as unknown as {
        listActiveConnectorBindings: () => Promise<
          Result<
            Array<{ connectorId: string; accountId: string | null }>,
            never
          >
        >
      }
    ).listActiveConnectorBindings = async () =>
      Result.ok([{ connectorId: 'github', accountId: null }])

    const result = await controller.ensureProxyMcpConnections()

    expect(result.isOk()).toBe(true)
    expect(removedServerIds).toEqual(['github'])
    expect(connectedServerIds).toEqual(['github'])
    expect(servers).toEqual([{ id: 'github', server_url: 'rpc:github' }])
  })

  it('replaces registered connector servers stuck in failed state before discovery', async () => {
    const now = Date.UTC(2026, 4, 9, 14, 30, 0)
    const servers: Array<{ id: string; server_url?: string }> = [
      { id: 'exa-search', server_url: 'rpc:exa-search' },
    ]
    const toolsByServer = new Map<string, McpToolRecord[]>()
    const serverStates: Record<string, { state: string; error?: string }> = {
      'exa-search': {
        state: 'failed',
        error: 'Network connection lost.',
      },
    }
    const removedServerIds: string[] = []
    const connectedServerIds: string[] = []
    const exaTools: McpToolRecord[] = [
      {
        serverId: 'exa-search',
        name: 'web_search',
        description: 'Search the web.',
        inputSchema: { type: 'object' },
      },
    ]
    const listTools = (filter?: MCPServerFilter) => {
      const serverId = filter?.serverId
      return serverId && !Array.isArray(serverId)
        ? (toolsByServer.get(serverId) ?? [])
        : [...toolsByServer.values()].flat()
    }

    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: {
        storage: {
          sql: createSqlStorageStub([
            {
              connectorId: 'exa-search',
              serverId: 'exa-search',
              accountId: null,
              jwtExpiresAt: new Date(
                now + MCP_PROXY_JWT_REFRESH_WINDOW_MS + 60_000,
              ).toISOString(),
              toolsSignature: null,
            },
          ]),
        },
      },
      mcp: {
        getAITools: () => ({}),
        listTools,
        listServers: () => servers,
        waitForConnections: async () => undefined,
        discoverIfConnected: async (serverId: string) =>
          toolsByServer.get(serverId)?.length
            ? { success: true }
            : { success: false, error: 'No tools discovered' },
      },
      getServerStates: () => serverStates,
      addRpcMcpServer: async ({ connectorId }) => {
        connectedServerIds.push(connectorId)
        servers.push({ id: connectorId, server_url: `rpc:${connectorId}` })
        toolsByServer.set(connectorId, exaTools)
        serverStates[connectorId] = { state: 'ready' }
        return { state: 'connected' }
      },
      removeMcpServer: async (connectorId) => {
        removedServerIds.push(connectorId)
        const index = servers.findIndex((server) => server.id === connectorId)
        if (index >= 0) servers.splice(index, 1)
        toolsByServer.delete(connectorId)
        delete serverStates[connectorId]
      },
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    }
    const controller = new RuntimeMcpController(host)
    ;(
      controller as unknown as {
        listActiveConnectorBindings: () => Promise<
          Result<
            Array<{ connectorId: string; accountId: string | null }>,
            never
          >
        >
      }
    ).listActiveConnectorBindings = async () =>
      Result.ok([{ connectorId: 'exa-search', accountId: null }])

    const result = await controller.ensureProxyMcpConnections()

    expect(result.isOk()).toBe(true)
    expect(removedServerIds).toEqual(['exa-search'])
    expect(connectedServerIds).toEqual(['exa-search'])
    expect(servers).toEqual([
      { id: 'exa-search', server_url: 'rpc:exa-search' },
    ])
    expect(host.mcp.listTools({ serverId: 'exa-search' })).toEqual(exaTools)
  })

  it('clears failed hidden SDK connections even when storage no longer lists the server', async () => {
    const removedServerIds: string[] = []
    const connectedServerIds: string[] = []
    const toolsByServer = new Map<string, McpToolRecord[]>()
    const githubTools: McpToolRecord[] = [
      {
        serverId: 'github',
        name: 'issue_read',
        description: 'Read a GitHub issue.',
        inputSchema: { type: 'object' },
      },
    ]

    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () => ({}),
        listTools: (filter?: MCPServerFilter) => {
          const serverId = filter?.serverId
          return serverId && !Array.isArray(serverId)
            ? (toolsByServer.get(serverId) ?? [])
            : [...toolsByServer.values()].flat()
        },
        listServers: () => [],
        waitForConnections: async () => undefined,
        discoverIfConnected: async (serverId: string) =>
          toolsByServer.get(serverId)?.length
            ? { success: true }
            : {
                success: false,
                error: 'Discovery skipped - connection in failed state',
              },
      },
      addRpcMcpServer: async ({ connectorId }) => {
        connectedServerIds.push(connectorId)
        toolsByServer.set(connectorId, githubTools)
        return { state: 'connected' }
      },
      removeMcpServer: async (connectorId) => {
        removedServerIds.push(connectorId)
        toolsByServer.delete(connectorId)
      },
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    }
    const controller = new RuntimeMcpController(host)
    ;(
      controller as unknown as {
        listActiveConnectorBindings: () => Promise<
          Result<
            Array<{ connectorId: string; accountId: string | null }>,
            never
          >
        >
      }
    ).listActiveConnectorBindings = async () =>
      Result.ok([{ connectorId: 'github', accountId: null }])

    const result = await controller.ensureProxyMcpConnections()

    expect(result.isOk()).toBe(true)
    expect(removedServerIds).toEqual(['github'])
    expect(connectedServerIds).toEqual(['github'])
  })

  it('resets and retries when the SDK connect path discovers a failed-state connection', async () => {
    const removedServerIds: string[] = []
    const connectedServerIds: string[] = []
    const toolsByServer = new Map<string, McpToolRecord[]>()
    const exaTools: McpToolRecord[] = [
      {
        serverId: 'exa-search',
        name: 'web_search_exa',
        description: 'Search the web.',
        inputSchema: { type: 'object' },
      },
    ]

    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () => ({}),
        listTools: (filter?: MCPServerFilter) => {
          const serverId = filter?.serverId
          return serverId && !Array.isArray(serverId)
            ? (toolsByServer.get(serverId) ?? [])
            : [...toolsByServer.values()].flat()
        },
        listServers: () => [],
        waitForConnections: async () => undefined,
        discoverIfConnected: async (serverId: string) =>
          toolsByServer.get(serverId)?.length
            ? { success: true }
            : { success: false, error: 'No tools discovered' },
      },
      addRpcMcpServer: async ({ connectorId }) => {
        connectedServerIds.push(connectorId)
        if (connectedServerIds.length === 1) {
          throw new Error(
            'Failed to discover server capabilities: Discovery skipped - connection in failed state',
          )
        }

        toolsByServer.set(connectorId, exaTools)
        return { state: 'connected' }
      },
      removeMcpServer: async (connectorId) => {
        removedServerIds.push(connectorId)
        toolsByServer.delete(connectorId)
      },
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    }
    const controller = new RuntimeMcpController(host)
    ;(
      controller as unknown as {
        listActiveConnectorBindings: () => Promise<
          Result<
            Array<{ connectorId: string; accountId: string | null }>,
            never
          >
        >
      }
    ).listActiveConnectorBindings = async () =>
      Result.ok([{ connectorId: 'exa-search', accountId: null }])

    const result = await controller.ensureProxyMcpConnections()

    expect(result.isOk()).toBe(true)
    expect(removedServerIds).toEqual(['exa-search', 'exa-search'])
    expect(connectedServerIds).toEqual(['exa-search', 'exa-search'])
    expect(host.mcp.listTools({ serverId: 'exa-search' })).toEqual(exaTools)
  })

  it('returns connector refresh errors instead of silently continuing', async () => {
    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () => ({}),
        listTools: () => [],
        listServers: () => [],
        waitForConnections: async () => undefined,
        discoverIfConnected: async () => ({ success: false }),
      },
      addRpcMcpServer: async () => ({
        state: 'failed',
        error: 'Proxy returned 503',
      }),
      removeMcpServer: async () => undefined,
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    }
    const controller = new RuntimeMcpController(host)
    ;(
      controller as unknown as {
        listActiveConnectorBindings: () => Promise<
          Result<
            Array<{ connectorId: string; accountId: string | null }>,
            never
          >
        >
      }
    ).listActiveConnectorBindings = async () =>
      Result.ok([{ connectorId: 'exa-search', accountId: null }])

    const result = await controller.ensureProxyMcpConnections()

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error.message).toContain('exa-search: Proxy returned 503')
  })

  it('throws for required turn readiness when connector refresh fails', async () => {
    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DATABASE_URL: 'postgres://garden.test/db',
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () => ({}),
        listTools: () => [],
        listServers: () => [],
        waitForConnections: async () => undefined,
        discoverIfConnected: async () => ({ success: false }),
      },
      addRpcMcpServer: async () => ({
        state: 'failed',
        error: 'Proxy returned 503',
      }),
      removeMcpServer: async () => undefined,
      resolveRuntimeIdentity: async () =>
        Result.ok({
          threadId: 'thread-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          agentId: 'agent-1',
        }),
    }
    const controller = new RuntimeMcpController(host)
    ;(
      controller as unknown as {
        listActiveConnectorBindings: () => Promise<
          Result<
            Array<{ connectorId: string; accountId: string | null }>,
            never
          >
        >
      }
    ).listActiveConnectorBindings = async () =>
      Result.ok([{ connectorId: 'exa-search', accountId: null }])

    const preparer = new RuntimeMcpConnectionPreparer({
      getController: () => controller,
      fullSyncIntervalMs: 60_000,
      backgroundRefreshFailedMessage: 'background failed',
      refreshFailedMessage: 'refresh failed',
      continuingWithoutReadyMessage: 'required failed',
      readinessPolicy: 'required',
    })

    await expect(preparer.ensureForTurn('issue-turn')).rejects.toMatchObject({
      name: RuntimeMcpError.name,
      code: 'mcp_readiness_failed',
    })
  })
})
