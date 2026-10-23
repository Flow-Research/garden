import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  CallToolResult,
  Progress,
} from '@modelcontextprotocol/sdk/types.js'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { Executor } from '@executor-js/sdk/core'
import {
  DECIDE_ANALYSIS_TIMEOUT_MS,
  DirectDecideMcpSessionManager,
  type DirectDecideMcpSession,
  type DirectDecideMcpSessionFactory,
  registerDirectDecideTools,
} from './direct-decide-mcp'
import type { GardenExecutorPlugins } from './plugins'

type RegisteredTool = {
  callback: (
    args: Record<string, unknown>,
    extra: {
      signal: AbortSignal
      _meta?: { progressToken?: string | number }
      sendNotification: (notification: unknown) => Promise<void>
    },
  ) => Promise<CallToolResult>
}

const registerHarness = (result: CallToolResult) => {
  const tools = new Map<string, RegisteredTool>()
  const calls: Array<{
    name: string
    args: Record<string, unknown>
    signal?: AbortSignal
    onProgress?: (progress: Progress) => void
  }> = []
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      callback: RegisteredTool['callback'],
    ) => {
      tools.set(name, { callback })
    },
  } as unknown as McpServer
  const executor = {
    connections: {
      list: () =>
        Effect.succeed([
          { owner: 'user', integration: 'decide', name: 'default' },
        ]),
    },
    directDecideMcp: {
      call: (
        _connection: unknown,
        request: { name: string; arguments: Record<string, unknown> },
        options: {
          signal?: AbortSignal
          onProgress?: (progress: Progress) => void
        },
      ) => {
        calls.push({
          name: request.name,
          args: request.arguments,
          signal: options.signal,
          onProgress: options.onProgress,
        })
        return Effect.succeed(result)
      },
    },
  } as unknown as Executor<GardenExecutorPlugins>

  registerDirectDecideTools(server, executor)
  return { calls, tools }
}

const toolExtra = (progressToken?: string | number) => {
  const notifications: unknown[] = []
  const sendNotification = vi.fn(async (notification: unknown) => {
    notifications.push(notification)
  })
  return {
    extra: {
      signal: new AbortController().signal,
      ...(progressToken === undefined ? {} : { _meta: { progressToken } }),
      sendNotification,
    },
    notifications,
  }
}

const makeSessionFactory = (
  behavior: (
    sessionIndex: number,
    requestId: number,
  ) => Promise<CallToolResult> = async () => ({ content: [] }),
) => {
  const sessions: Array<{
    requestIds: number[]
    pendingIds: number[]
    close: ReturnType<typeof vi.fn>
    disconnect: () => void
  }> = []
  const factory: DirectDecideMcpSessionFactory = ({ onDisconnect }) => {
    const sessionIndex = sessions.length
    let nextRequestId = 0
    const pendingIds: number[] = []
    const close = vi.fn(async () => {
      pendingIds.length = 0
    })
    const record = {
      requestIds: [] as number[],
      pendingIds,
      close,
      disconnect: onDisconnect,
    }
    const session: DirectDecideMcpSession = {
      connect: vi.fn(async () => undefined),
      call: vi.fn(async () => {
        const requestId = nextRequestId
        nextRequestId += 1
        record.requestIds.push(requestId)
        record.pendingIds.push(requestId)
        return behavior(sessionIndex, requestId).finally(() => {
          const pendingIndex = record.pendingIds.indexOf(requestId)
          if (pendingIndex >= 0) record.pendingIds.splice(pendingIndex, 1)
        })
      }),
      close,
    }
    sessions.push(record)
    return session
  }
  return { factory, sessions }
}

describe('direct Decide MCP tools', () => {
  it('hands the complete CSV to Decide analyze', async () => {
    const csv = 'region,revenue\nNorth,120\nSouth,95\n'
    const { calls, tools } = registerHarness({
      content: [{ type: 'text', text: 'North leads.' }],
    })

    await tools
      .get('decide_analyze')
      ?.callback(
        { question: 'Which region leads?', data: csv },
        toolExtra().extra,
      )

    expect(calls).toMatchObject([
      {
        name: 'analyze',
        args: { question: 'Which region leads?', data: csv },
      },
    ])
  })

  it('passes session_id without adding data for a follow-up', async () => {
    const { calls, tools } = registerHarness({ content: [] })

    await tools
      .get('decide_analyze')
      ?.callback(
        { question: 'Break it down by product.', session_id: 'sess_123' },
        toolExtra().extra,
      )

    expect(calls[0]?.args).toEqual({
      question: 'Break it down by product.',
      session_id: 'sess_123',
    })
  })

  it('preserves multiple content blocks, session_id, and file URLs', async () => {
    const providerResult = {
      content: [
        { type: 'text' as const, text: 'Finding one.' },
        { type: 'text' as const, text: 'Finding two.' },
        {
          type: 'resource_link' as const,
          name: 'sales.xlsx',
          uri: 'https://api.trydecide.ai/uploads/sales.xlsx',
        },
      ],
      structuredContent: { session_id: 'sess_123' },
    }
    const { tools } = registerHarness(providerResult)

    const returned = await tools
      .get('decide_analyze')
      ?.callback(
        { question: 'Analyze this.', data: 'a,b\n1,2' },
        toolExtra().extra,
      )

    expect(returned).toEqual(providerResult)
  })

  it('preserves Decide tool errors exactly', async () => {
    const providerError = {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: 'Not enough Decide credits to run this request.',
        },
      ],
    }
    const { tools } = registerHarness(providerError)

    const returned = await tools
      .get('decide_analyze')
      ?.callback({ question: 'Analyze this.' }, toolExtra().extra)

    expect(returned).toEqual(providerError)
  })

  it('forwards public MCP progress with the caller progress token', async () => {
    const { calls, tools } = registerHarness({ content: [] })
    const { extra, notifications } = toolExtra('garden-progress-1')

    await tools
      .get('decide_analyze')
      ?.callback({ question: 'Analyze this.' }, extra)
    calls[0]?.onProgress?.({
      progress: 2,
      total: 4,
      message: 'Reviewing revenue by region.',
    })
    await Promise.resolve()

    expect(notifications).toEqual([
      {
        method: 'notifications/progress',
        params: {
          progressToken: 'garden-progress-1',
          progress: 2,
          total: 4,
          message: 'Reviewing revenue by region.',
        },
      },
    ])
  })

  it('uses a timeout longer than Decide documented four-minute default', () => {
    expect(DECIDE_ANALYSIS_TIMEOUT_MS).toBeGreaterThan(4 * 60_000)
  })

  it('keeps request IDs unique across repeated calls on one connection', async () => {
    const { factory, sessions } = makeSessionFactory()
    const manager = new DirectDecideMcpSessionManager(factory)

    await manager.call(
      'user:decide:default',
      'token',
      {
        name: 'whoami',
        arguments: {},
      },
      {},
    )
    await manager.call(
      'user:decide:default',
      'token',
      {
        name: 'whoami',
        arguments: {},
      },
      {},
    )

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.requestIds).toEqual([0, 1])
    expect(sessions[0]?.pendingIds).toEqual([])
  })

  it('assigns unique request IDs to concurrent calls', async () => {
    const { factory, sessions } = makeSessionFactory(async () => {
      await Promise.resolve()
      return { content: [] }
    })
    const manager = new DirectDecideMcpSessionManager(factory)

    await Promise.all([
      manager.call(
        'user:decide:default',
        'token',
        {
          name: 'whoami',
          arguments: {},
        },
        {},
      ),
      manager.call(
        'user:decide:default',
        'token',
        {
          name: 'whoami',
          arguments: {},
        },
        {},
      ),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.requestIds).toEqual([0, 1])
    expect(sessions[0]?.pendingIds).toEqual([])
  })

  it('closes a failed session before reconnecting', async () => {
    const { factory, sessions } = makeSessionFactory(async (sessionIndex) => {
      if (sessionIndex === 0) {
        return Promise.reject(new Error('transport disconnected'))
      }
      return { content: [] }
    })
    const manager = new DirectDecideMcpSessionManager(factory)

    await expect(
      manager.call(
        'user:decide:default',
        'token',
        {
          name: 'whoami',
          arguments: {},
        },
        {},
      ),
    ).rejects.toThrow('transport disconnected')
    await Promise.resolve()
    expect(sessions[0]?.pendingIds).toEqual([])
    await manager.call(
      'user:decide:default',
      'token',
      {
        name: 'whoami',
        arguments: {},
      },
      {},
    )

    expect(sessions[0]?.close).toHaveBeenCalledOnce()
    expect(sessions[1]?.requestIds).toEqual([0])
  })

  it('clears the session after a timeout so the next call has fresh state', async () => {
    const { factory, sessions } = makeSessionFactory(async (sessionIndex) => {
      if (sessionIndex === 0) {
        return Promise.reject(new Error('Request timed out'))
      }
      return { content: [] }
    })
    const manager = new DirectDecideMcpSessionManager(factory)

    await expect(
      manager.call(
        'user:decide:default',
        'token',
        {
          name: 'analyze',
          arguments: { question: 'test' },
        },
        {},
      ),
    ).rejects.toThrow('Request timed out')
    await Promise.resolve()
    expect(sessions[0]?.pendingIds).toEqual([])
    await manager.call(
      'user:decide:default',
      'token',
      {
        name: 'analyze',
        arguments: { question: 'test' },
      },
      {},
    )

    expect(sessions[0]?.close).toHaveBeenCalledOnce()
    expect(sessions[1]?.requestIds).toEqual([0])
  })

  it('drops a disconnected session and clears pending requests', async () => {
    let releaseFirstCall: (() => void) | undefined
    const { factory, sessions } = makeSessionFactory(async (sessionIndex) => {
      if (sessionIndex === 0) {
        return new Promise<CallToolResult>((resolve) => {
          releaseFirstCall = () => resolve({ content: [] })
        })
      }
      return { content: [] }
    })
    const manager = new DirectDecideMcpSessionManager(factory)

    const firstCall = manager.call(
      'user:decide:default',
      'token',
      {
        name: 'whoami',
        arguments: {},
      },
      {},
    )
    await vi.waitFor(() => {
      expect(sessions[0]?.pendingIds).toEqual([0])
    })
    sessions[0]?.disconnect()
    await vi.waitFor(() => {
      expect(sessions[0]?.pendingIds).toEqual([])
    })
    await manager.call(
      'user:decide:default',
      'token',
      {
        name: 'whoami',
        arguments: {},
      },
      {},
    )

    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
    expect(sessions[1]?.requestIds).toEqual([0])
    releaseFirstCall?.()
    await firstCall
  })

  it('drops a session when its MCP handshake fails', async () => {
    const sessions: Array<{ close: ReturnType<typeof vi.fn> }> = []
    const factory: DirectDecideMcpSessionFactory = () => {
      const sessionIndex = sessions.length
      const close = vi.fn(async () => undefined)
      sessions.push({ close })
      return {
        connect: vi.fn(async () => {
          if (sessionIndex === 0) {
            return Promise.reject(new Error('handshake failed'))
          }
        }),
        call: vi.fn(async () => ({ content: [] })),
        close,
      }
    }
    const manager = new DirectDecideMcpSessionManager(factory)

    await expect(
      manager.call(
        'user:decide:default',
        'token',
        {
          name: 'whoami',
          arguments: {},
        },
        {},
      ),
    ).rejects.toThrow('handshake failed')
    await manager.call(
      'user:decide:default',
      'token',
      {
        name: 'whoami',
        arguments: {},
      },
      {},
    )

    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
  })
})
