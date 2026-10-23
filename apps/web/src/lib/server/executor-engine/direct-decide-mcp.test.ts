import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  CallToolResult,
  Progress,
} from '@modelcontextprotocol/sdk/types.js'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Executor } from '@executor-js/sdk/core'
import {
  DECIDE_ANALYSIS_TIMEOUT_MS,
  DirectDecideMcpError,
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

const registerHarness = (result: CallToolResult | DirectDecideMcpError) => {
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
        return result instanceof DirectDecideMcpError
          ? Effect.fail(result)
          : Effect.succeed(result)
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

describe('direct Decide MCP tools', () => {
  afterEach(() => vi.restoreAllMocks())

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
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'decide.tool_call.failed',
        toolName: 'analyze',
        failureStage: 'provider_result',
        failureMessage: 'Not enough Decide credits to run this request.',
      }),
    )
  })

  it('returns and logs the exact typed direct-call failure', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools } = registerHarness(
      new DirectDecideMcpError({
        stage: 'call',
        status: 401,
        message: 'Unauthorized Decide credential.',
      }),
    )

    const returned = await tools
      .get('decide_analyze')
      ?.callback({ question: 'Analyze this.' }, toolExtra().extra)

    expect(returned).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Decide analyze failed during call: Unauthorized Decide credential.',
        },
      ],
    })
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'decide.tool_call.failed',
        toolName: 'analyze',
        failureStage: 'call',
        failureMessage: 'Unauthorized Decide credential.',
        status: 401,
      }),
    )
  })

  it('logs successful direct calls without request contents', async () => {
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { tools } = registerHarness({
      content: [{ type: 'text', text: 'Sensitive generated result.' }],
      structuredContent: { session_id: 'sess_123' },
    })

    await tools
      .get('decide_analyze')
      ?.callback(
        { question: 'Sensitive question.', data: 'secret,csv\n1,2' },
        toolExtra().extra,
      )

    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'decide.tool_call.started',
        toolName: 'analyze',
      }),
    )
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'decide.tool_call.completed',
        toolName: 'analyze',
        contentBlockCount: 1,
        hasStructuredContent: true,
      }),
    )
    expect(JSON.stringify(infoLog.mock.calls)).not.toContain('secret,csv')
    expect(JSON.stringify(infoLog.mock.calls)).not.toContain(
      'Sensitive question.',
    )
    expect(JSON.stringify(infoLog.mock.calls)).not.toContain(
      'Sensitive generated result.',
    )
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
})
