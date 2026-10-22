import type { ToolSet } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { RuntimeMcpController, type McpHost } from './runtime-mcp-controller'

const EXECUTOR_TOOL = 'execute'

function makeLoggingController(execute: () => Promise<unknown>) {
  const rawToolKey = buildMcpAiToolKey('executor', EXECUTOR_TOOL)
  const rawTools = {
    [rawToolKey]: {
      name: EXECUTOR_TOOL,
      description: 'probe executor tool',
      inputSchema: z.object({}),
      execute,
    },
  } as unknown as ToolSet
  const host = {
    name: 'executor-logging-probe',
    env: { HYPERDRIVE: { connectionString: 'postgres://unused' } },
    ctx: { storage: { sql: {} } },
    mcp: {
      getAITools: () => rawTools,
      listTools: () => [
        {
          name: EXECUTOR_TOOL,
          serverId: 'executor',
          description: 'Run code against connected integrations.',
          inputSchema: z.object({}),
        },
      ],
      listServers: () => [{ id: 'executor' }],
      discoverIfConnected: async () => ({ success: true }),
    },
    removeMcpServer: async () => {},
  } as unknown as McpHost
  return { controller: new RuntimeMcpController(host), rawToolKey }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('executor tool lifecycle logging', () => {
  it('logs safe lifecycle fields and preserves the full result envelope', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const execute = vi.fn(async () => ({
      content: [
        { type: 'text', text: 'analysis block' },
        {
          type: 'resource',
          resource: { uri: 'https://example.com/report.xlsx' },
        },
      ],
      structuredContent: { session_id: 'session-123' },
    }))
    const { controller, rawToolKey } = makeLoggingController(execute)
    const wrapped = controller.wrapGetAITools(() => ({
      [rawToolKey]: {
        name: EXECUTOR_TOOL,
        description: 'probe executor tool',
        inputSchema: z.object({}),
        execute,
      },
    }))
    const tool = wrapped[rawToolKey] as unknown as {
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }

    const output = await tool.execute(
      {
        code: 'await tools.decide.user.decide.analyze({ data: csv })',
      },
      { toolCallId: 'call-123' },
    )

    expect(output).toEqual({
      content: [
        { type: 'text', text: 'analysis block' },
        {
          type: 'resource',
          resource: { uri: 'https://example.com/report.xlsx' },
        },
      ],
      structuredContent: { session_id: 'session-123' },
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(info.mock.calls.map(([record]) => record)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'mcp.tool_call.started',
          toolCallId: 'call-123',
          executorSlugs: ['decide'],
          codeLength: expect.any(Number),
        }),
        expect.objectContaining({
          event: 'mcp.tool_call.completed',
          contentBlockCount: 2,
          generatedFileUrlCount: 1,
          hasContinuationId: true,
        }),
      ]),
    )
    expect(JSON.stringify(info.mock.calls)).not.toContain('data: csv')
  })

  it('logs the Decide failure stage and rethrows the exact error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('Not enough Decide credits to run this request.')
    const { controller, rawToolKey } = makeLoggingController(async () => {
      throw failure
    })
    const wrapped = controller.wrapGetAITools(() => ({
      [rawToolKey]: {
        name: EXECUTOR_TOOL,
        description: 'probe executor tool',
        inputSchema: z.object({}),
        execute: async () => {
          throw failure
        },
      },
    }))
    const tool = wrapped[rawToolKey] as unknown as {
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }

    await expect(
      tool.execute(
        {
          code: 'await tools.decide.user.decide.analyze({ data: csv })',
        },
        { toolCallId: 'call-failure' },
      ),
    ).rejects.toBe(failure)
    expect(error.mock.calls.map(([record]) => record)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'mcp.tool_call.failed',
          failureStage: 'decide_analysis',
          errorMessage: failure.message,
        }),
      ]),
    )
  })
})
