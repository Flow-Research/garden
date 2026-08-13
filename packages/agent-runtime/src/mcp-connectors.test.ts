import { describe, expect, it } from 'vitest'
import { Result } from 'better-result'
import type { ToolSet } from 'ai'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import {
  buildConnectorSyncPlan,
  hasWarmStoredConnectorServers,
  extractThreadIdFromAgentName,
  type StoredConnectorServerRow,
} from './mcp-connectors'
import {
  isMcpFailedConnectionStateMessage,
  isMcpDiscoveryCancellation,
  executorMcpSessionScopeMatches,
  RuntimeMcpController,
  RuntimeMcpConnectionPreparer,
  RuntimeMcpError,
  type McpHost,
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
          toolsSignature,
        ] = params

        rows.set(String(connectorId), {
          connector_id: connectorId,
          server_id: serverId,
          account_id: accountId,
          workspace_id: workspaceId,
          user_id: userId,
          agent_id: agentId,
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
    })

    expect(plan.connectorIdsToRemove).toEqual([])
    expect(plan.bindingsToRefresh).toEqual([
      { connectorId: 'github', accountId: 'account-1' },
    ])
  })

  it('removes stale stored connectors and keeps fresh ones', () => {
    const plan = buildConnectorSyncPlan({
      bindings: [{ connectorId: 'gmail', accountId: 'account-2' }],
      storedRows: [
        {
          connectorId: 'gmail',
          serverId: 'gmail',
          accountId: 'account-2',
          toolsSignature: null,
        },
        {
          connectorId: 'slack',
          serverId: 'slack',
          accountId: 'account-3',
          toolsSignature: null,
        },
      ],
    })

    expect(plan.connectorIdsToRemove).toEqual(['slack'])
    expect(plan.bindingsToRefresh).toEqual([])
  })

  it('refreshes stored bindings whose server is not registered in memory', () => {
    const plan = buildConnectorSyncPlan({
      bindings: [{ connectorId: 'slack', accountId: null }],
      registeredServerIds: [],
      storedRows: [
        {
          connectorId: 'slack',
          serverId: 'slack',
          accountId: null,
          toolsSignature: null,
        },
      ],
    })

    expect(plan.connectorIdsToRemove).toEqual([])
    expect(plan.bindingsToRefresh).toEqual([
      { connectorId: 'slack', accountId: null },
    ])
  })

  it('refreshes bindings whose account changed', () => {
    const plan = buildConnectorSyncPlan({
      bindings: [
        { connectorId: 'google-drive', accountId: 'account-4' },
        { connectorId: 'slack', accountId: null },
      ],
      storedRows: [
        {
          connectorId: 'google-drive',
          serverId: 'google-drive',
          accountId: 'old-account',
          toolsSignature: null,
        },
        {
          connectorId: 'slack',
          serverId: 'slack',
          accountId: null,
          toolsSignature: null,
        },
      ],
    })

    expect(plan.connectorIdsToRemove).toEqual([])
    expect(plan.bindingsToRefresh).toEqual([
      { connectorId: 'google-drive', accountId: 'account-4' },
    ])
  })
})

describe('hasWarmStoredConnectorServers', () => {
  it('returns true when every stored connector is registered', () => {
    expect(
      hasWarmStoredConnectorServers({
        registeredServerIds: ['github', 'slack'],
        storedRows: [
          {
            connectorId: 'github',
            serverId: 'github',
            accountId: 'account-1',
            toolsSignature: null,
          },
          {
            connectorId: 'slack',
            serverId: 'slack',
            accountId: null,
            toolsSignature: null,
          },
        ],
      }),
    ).toBe(true)
  })

  it('returns false when storage is empty or missing a server', () => {
    expect(
      hasWarmStoredConnectorServers({
        registeredServerIds: ['github'],
        storedRows: [],
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
            toolsSignature: null,
          },
        ],
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

describe('RuntimeMcpController native installations', () => {
  it('activates Discord tools with the persisted workspace guild binding', async () => {
    let registeredServerId: string | undefined
    let registeredServerName: string | undefined
    let registeredResource: { kind: string; slug?: string } | undefined
    let registeredConnectionNames: readonly string[] | undefined
    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        DISCORD_BOT_TOKEN: 'bot-token',
        HYPERDRIVE: {
          connectionString: 'postgres://garden.test/db',
        } as unknown as Hyperdrive,
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () => ({}),
        listTools: () => [],
        listServers: () => [],
        discoverIfConnected: async () => ({ success: true }),
      },
      addExecutorMcpServer: async ({ id, serverName, props }) => {
        registeredServerId = id
        registeredServerName = serverName
        registeredResource = props.session.resource
        registeredConnectionNames = props.session.toolkitConnectionNames
        return { state: 'connected' }
      },
      getExecutorMcpResource: () => ({
        kind: 'toolkit',
        slug: 'garden-mail-174e67d2-bcbc-420b-a1f5-289ee6681b8f',
      }),
      getExecutorToolkitConnectionNames: () => ['gmail_personal'],
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
      Result.ok([{ connectorId: 'discord', accountId: 'guild-1' }])

    const ready = await controller.ensureProxyMcpConnections()
    expect(ready.isOk()).toBe(true)
    expect(registeredServerId).toBe('executor')
    expect(registeredServerName).toBe(
      'garden-mail-174e67d2-bcbc-420b-a1f5-289ee6681b8f',
    )
    expect(registeredResource).toEqual({
      kind: 'toolkit',
      slug: 'garden-mail-174e67d2-bcbc-420b-a1f5-289ee6681b8f',
    })
    expect(registeredConnectionNames).toEqual(['gmail_personal'])

    const aiTools = controller.wrapGetAITools(() => ({}))
    expect(
      aiTools[buildMcpAiToolKey('discord', 'discord_list_servers')],
    ).toBeDefined()
  })
})

describe('RuntimeMcpController Executor session scope', () => {
  const desiredSession = {
    organizationId: 'workspace-1',
    userId: 'user-1',
    elicitationMode: 'browser' as const,
    resource: {
      kind: 'toolkit' as const,
      slug: 'garden-mail-runtime-1',
    },
    toolkitConnectionNames: ['gmail'],
    webOrigin: 'https://garden.test',
  }

  const desiredRegistration = {
    bindingName: 'EXECUTOR_MCP_SESSION',
    serverName: 'garden-mail-runtime-1',
    session: desiredSession,
  }

  const storedOptions = (
    session: unknown,
    bindingName = 'EXECUTOR_MCP_SESSION',
  ) =>
    JSON.stringify({
      bindingName,
      props: { session },
    })

  it('compares the complete restored RPC route and authority', () => {
    expect(
      executorMcpSessionScopeMatches(
        {
          server_url: 'rpc:garden-mail-runtime-1',
          server_options: storedOptions({
            ...desiredSession,
            toolkitConnectionNames: ['gmail'],
          }),
        },
        desiredRegistration,
      ),
    ).toBe(true)
    expect(
      executorMcpSessionScopeMatches(
        {
          server_url: 'rpc:executor',
          server_options: storedOptions(desiredSession),
        },
        desiredRegistration,
      ),
    ).toBe(false)
    expect(
      executorMcpSessionScopeMatches(
        {
          server_url: 'rpc:garden-mail-runtime-1',
          server_options: storedOptions(desiredSession, 'OTHER_BINDING'),
        },
        desiredRegistration,
      ),
    ).toBe(false)
    expect(
      executorMcpSessionScopeMatches(
        {
          server_url: 'rpc:garden-mail-runtime-1',
          server_options: '{broken',
        },
        desiredRegistration,
      ),
    ).toBe(false)
  })

  type RestoredExecutor = {
    readonly bindingName: string
    readonly serverName: string
    readonly session: unknown
  }

  /** Builds a restored Agents SDK server plus observable registration seams. */
  const makeController = (initial: RestoredExecutor) => {
    let executorRegistered = true
    let persistedServerUrl: string | null = `rpc:${initial.serverName}`
    let persistedOptions: string | null = storedOptions(
      initial.session,
      initial.bindingName,
    )
    const registeredSessions: unknown[] = []
    const registeredServerNames: string[] = []
    const removedServerIds: string[] = []
    const storage = {
      exec(sql: string) {
        const normalized = sql.trim().toLowerCase()
        if (
          normalized.startsWith('select server_url, server_options') &&
          normalized.includes('from cf_agents_mcp_servers')
        ) {
          return persistedOptions === null
            ? []
            : [
                {
                  server_url: persistedServerUrl,
                  server_options: persistedOptions,
                },
              ]
        }
        return []
      },
    } as unknown as SqlStorage
    const host: McpHost = {
      name: 'chat:runtime-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        HYPERDRIVE: {
          connectionString: 'postgres://garden.test/db',
        } as unknown as Hyperdrive,
      },
      ctx: { storage: { sql: storage } },
      mcp: {
        getAITools: () => ({}),
        listTools: () => [],
        listServers: () =>
          executorRegistered
            ? [{ id: 'executor', server_url: persistedServerUrl }]
            : [],
        discoverIfConnected: async () => ({ success: true }),
      },
      addExecutorMcpServer: async ({ serverName, props }) => {
        registeredServerNames.push(serverName)
        registeredSessions.push(props.session)
        executorRegistered = true
        persistedServerUrl = `rpc:${serverName}`
        persistedOptions = storedOptions(props.session)
        return { state: 'connected' }
      },
      getExecutorMcpResource: () => desiredSession.resource,
      getExecutorToolkitConnectionNames: () =>
        desiredSession.toolkitConnectionNames,
      removeMcpServer: async (serverId) => {
        removedServerIds.push(serverId)
        executorRegistered = false
        persistedServerUrl = null
        persistedOptions = null
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
        listActiveConnectorBindings: () => Promise<Result<Array<never>, never>>
      }
    ).listActiveConnectorBindings = async () => Result.ok([])
    return {
      controller,
      registeredServerNames,
      registeredSessions,
      removedServerIds,
    }
  }

  it('replaces a restored default Executor session with the Inbox toolkit', async () => {
    const runtime = makeController({
      bindingName: 'EXECUTOR_MCP_SESSION',
      serverName: 'executor',
      session: {
        ...desiredSession,
        elicitationMode: 'model',
        resource: { kind: 'default' },
        toolkitConnectionNames: [],
      },
    })

    const prepared = await runtime.controller.ensureProxyMcpConnections()

    expect(prepared.isOk()).toBe(true)
    expect(runtime.removedServerIds).toEqual(['executor'])
    expect(runtime.registeredServerNames).toEqual(['garden-mail-runtime-1'])
    expect(runtime.registeredSessions).toEqual([desiredSession])
  })

  it('replaces a matching remote route restored through the wrong binding', async () => {
    const runtime = makeController({
      bindingName: 'OTHER_BINDING',
      serverName: 'garden-mail-runtime-1',
      session: desiredSession,
    })

    const prepared = await runtime.controller.ensureProxyMcpConnections()

    expect(prepared.isOk()).toBe(true)
    expect(runtime.removedServerIds).toEqual(['executor'])
    expect(runtime.registeredServerNames).toEqual(['garden-mail-runtime-1'])
    expect(runtime.registeredSessions).toEqual([desiredSession])
  })

  it('keeps a restored Executor session whose Inbox scope still matches', async () => {
    const runtime = makeController({
      bindingName: 'EXECUTOR_MCP_SESSION',
      serverName: 'garden-mail-runtime-1',
      session: desiredSession,
    })

    const prepared = await runtime.controller.ensureProxyMcpConnections()

    expect(prepared.isOk()).toBe(true)
    expect(runtime.removedServerIds).toEqual([])
    expect(runtime.registeredServerNames).toEqual([])
    expect(runtime.registeredSessions).toEqual([])
  })
})

describe('RuntimeMcpConnectionPreparer scoped reload', () => {
  it('waits for default prewarm before replacing it with the mail-turn session', async () => {
    let releasePrewarm: (() => void) | undefined
    let ensureCalls = 0
    const events: string[] = []
    const controller = {
      ensureProxyMcpConnections: async () => {
        ensureCalls += 1
        events.push(`ensure:${ensureCalls}:start`)
        if (ensureCalls === 1) {
          await new Promise<void>((resolve) => {
            releasePrewarm = resolve
          })
        }
        events.push(`ensure:${ensureCalls}:end`)
        return Result.ok(undefined)
      },
      resetProxyMcpServers: async () => {
        events.push('reset')
        return Result.ok(undefined)
      },
      captureObservedMcpToolChanges: () => Result.ok([]),
    } as unknown as RuntimeMcpController
    const preparer = new RuntimeMcpConnectionPreparer({
      getController: () => controller,
      fullSyncIntervalMs: 60_000,
      backgroundRefreshFailedMessage: 'background failed',
      refreshFailedMessage: 'refresh failed',
      continuingWithoutReadyMessage: 'continuing',
    })

    const prewarm = preparer.ensureLoaded('client-prewarm')
    const mailTurn = preparer.reload('mail-turn')
    await Promise.resolve()
    expect(events).toEqual(['ensure:1:start'])

    releasePrewarm?.()
    expect((await prewarm).isOk()).toBe(true)
    expect((await mailTurn).isOk()).toBe(true)
    expect(events).toEqual([
      'ensure:1:start',
      'ensure:1:end',
      'reset',
      'ensure:2:start',
      'ensure:2:end',
    ])
  })
})

describe('RuntimeMcpController GitHub tools', () => {
  it('executes the hosted GitHub MCP source instead of mirroring native REST tools', async () => {
    const calls: Array<{ name: string; input: unknown }> = []
    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        HYPERDRIVE: {
          connectionString: 'postgres://garden.test/db',
        } as unknown as Hyperdrive,
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () => ({}),
        listTools: () => [],
        listServers: () => [],
        discoverIfConnected: async () => ({ success: true }),
      },
      githubHostedMcp: {
        listTools: async () => [
          {
            name: 'list_issues',
            description: 'List issues through GitHub hosted MCP.',
            inputSchema: { type: 'object' },
          },
        ],
        callTool: async (_installationId, name, input) => {
          calls.push({ name, input })
          return { content: [{ type: 'text', text: 'hosted-mcp-result' }] }
        },
      },
      addExecutorMcpServer: async () => ({ state: 'connected' }),
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
      controller as unknown as { githubHostedCapabilitiesSynced: boolean }
    ).githubHostedCapabilitiesSynced = true
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
      Result.ok([{ connectorId: 'github', accountId: 'installation-1' }])

    const ready = await controller.ensureProxyMcpConnections()
    expect(ready.isOk()).toBe(true)

    const aiTools = controller.wrapGetAITools(() => ({}))
    const hostedTool = aiTools[buildMcpAiToolKey('github-mcp', 'list_issues')]
    await expect(
      hostedTool?.execute?.({ owner: 'flow' } as never, {} as never),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'hosted-mcp-result' }],
    })
    expect(calls).toEqual([{ name: 'list_issues', input: { owner: 'flow' } }])
  })

  it('returns connector tool transport failures as tool output instead of throwing', async () => {
    const toolKey = buildMcpAiToolKey('slack', 'slack_read_channel')
    const controller = new RuntimeMcpController({
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        HYPERDRIVE: {
          connectionString: 'postgres://garden.test/db',
        } as unknown as Hyperdrive,
      },
      ctx: { storage: { sql: createSqlStorageStub() } },
      mcp: {
        getAITools: () =>
          ({
            [toolKey]: {
              description: 'Read a Slack channel.',
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
            serverId: 'slack',
            name: 'slack_read_channel',
            description: 'Read a Slack channel.',
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
            description: 'Read a Slack channel.',
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
        'slack.slack_read_channel failed: Request timeout: No response received within 120000ms',
    })
  })

  it('throws for required turn readiness when connector refresh fails', async () => {
    const host: McpHost = {
      name: 'chat:thread-1',
      env: {
        BETTER_AUTH_SECRET: 'secret',
        BETTER_AUTH_URL: 'https://garden.test',
        HYPERDRIVE: {
          connectionString: 'postgres://garden.test/db',
        } as unknown as Hyperdrive,
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
      Result.ok([{ connectorId: 'slack', accountId: null }])

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
