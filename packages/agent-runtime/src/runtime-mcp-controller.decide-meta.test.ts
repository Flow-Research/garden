import type { ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import type { DecideAnalysisOwner } from './decide-analysis-types'
import { RuntimeMcpController, type McpHost } from './runtime-mcp-controller'

const DECIDE_TOOL = 'decide_analyze'

/** Calls `decide_analyze` through the wrapper and returns the MCP `_meta`. */
async function decideMeta(input: {
  name: string
  decideAnalysisOwner?: () => DecideAnalysisOwner
}) {
  const rawToolKey = buildMcpAiToolKey('executor', DECIDE_TOOL)
  const execute = vi.fn(async () => ({ content: [] }))
  const callTool = vi.fn<McpHost['mcp']['callTool']>(async () => ({
    content: [],
  }))
  const rawTools = {
    [rawToolKey]: {
      name: DECIDE_TOOL,
      description: 'decide',
      inputSchema: z.object({}),
      execute,
    },
  } as unknown as ToolSet
  const host = {
    name: input.name,
    env: { HYPERDRIVE: { connectionString: 'postgres://unused' } },
    ctx: { storage: { sql: {} } },
    mcp: {
      getAITools: () => rawTools,
      listTools: () => [
        { name: DECIDE_TOOL, serverId: 'executor', inputSchema: {} },
      ],
      listServers: () => [{ id: 'executor' }],
      discoverIfConnected: async () => ({ success: true }),
      callTool,
    },
    removeMcpServer: async () => {},
    ...(input.decideAnalysisOwner === undefined
      ? {}
      : { decideAnalysisOwner: input.decideAnalysisOwner }),
  } as unknown as McpHost
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const wrapped = new RuntimeMcpController(host).wrapGetAITools(() => rawTools)
  const tool = wrapped[rawToolKey] as unknown as {
    execute: (input: unknown, options: unknown) => Promise<unknown>
  }
  await tool.execute(
    { question: 'q', automationRunId: 'model-supplied' },
    { toolCallId: 'call-1' },
  )
  const params = callTool.mock.calls[0]?.[0] as { _meta?: unknown } | undefined
  return params?._meta
}

describe('decide_analyze trusted owner metadata', () => {
  it('keeps the chat thread owner for chat facets', async () => {
    expect(await decideMeta({ name: 'thread-1' })).toEqual({
      garden: { kind: 'chat', threadId: 'thread-1', toolCallId: 'call-1' },
    })
  })

  it('sends the automation run owner the facet supplies, not model input', async () => {
    expect(
      await decideMeta({
        name: 'automation-run-1',
        decideAnalysisOwner: () => ({
          kind: 'automation_run',
          automationRunId: 'automation-run-1',
        }),
      }),
    ).toEqual({
      garden: {
        kind: 'automation_run',
        automationRunId: 'automation-run-1',
        toolCallId: 'call-1',
      },
    })
  })
})
