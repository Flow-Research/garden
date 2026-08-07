import { Effect } from 'effect'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import type { ExecutionEngine } from '@executor-js/execution/core'
import { createExecutorMcpServer } from '@executor-js/host-mcp/tool-server'

import { boundExecutionEngine } from './output-bound'

/** Runs assertions through a real MCP client/server transport and closes both. */
const withMcpClient = async (
  engine: ExecutionEngine<never>,
  run: (client: Client) => Promise<void>,
) => {
  const server = await Effect.runPromise(
    createExecutorMcpServer({
      engine,
      artifactsEnabled: false,
      elicitationMode: { mode: 'model' },
    }),
  )
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: 'garden-test', version: '1.0.0' },
    { capabilities: {} },
  )
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  await run(client).finally(async () => {
    await Promise.all([clientTransport.close(), serverTransport.close()])
  })
}

/**
 * Exercises the same execute/skills/resume tool surface Garden serves. The
 * engine is deterministic; MCP registration, validation, formatting, and
 * transport are the real Executor v1.5.40 implementation.
 */
const makeBehaviorEngine = (): ExecutionEngine<never> => ({
  execute: (code) => Effect.succeed({ result: `ran: ${code}` }),
  executeWithPause: (code) =>
    Effect.succeed({
      status: 'completed',
      result: { result: `ran: ${code}` },
    }),
  resume: (executionId, response) =>
    Effect.succeed({
      status: 'completed',
      result: {
        result: { executionId, action: response.action },
      },
    }),
  getPausedExecution: () => Effect.succeed(null),
  pausedExecutionCount: () => Effect.succeed(0),
  hasPausedExecutions: () => Effect.succeed(false),
  getDescription: Effect.succeed('Garden Executor'),
})

describe('Garden Executor MCP tool surface', () => {
  it('serves execute, skills, and model resume over real MCP transport', async () => {
    await withMcpClient(
      boundExecutionEngine(makeBehaviorEngine()),
      async (client) => {
        const tools = await client.listTools()
        expect(tools.tools.map((tool) => tool.name)).toEqual([
          'execute',
          'skills',
          'resume',
        ])

        const execution = await client.callTool({
          name: 'execute',
          arguments: { code: 'return 2 + 2' },
        })
        expect(execution.content).toEqual([
          { type: 'text', text: 'ran: return 2 + 2' },
        ])

        const skill = await client.callTool({
          name: 'skills',
          arguments: { name: 'execute' },
        })
        expect(JSON.stringify(skill.content)).toContain('# execute')

        const resumed = await client.callTool({
          name: 'resume',
          arguments: {
            executionId: 'exec_1',
            action: 'accept',
            content: '{}',
          },
        })
        expect(resumed.structuredContent).toMatchObject({
          status: 'completed',
          result: expect.stringContaining('exec_1'),
        })
      },
    )
  })
})
