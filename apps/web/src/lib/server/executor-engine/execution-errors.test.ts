import { Effect } from 'effect'
import { makeExecutorToolInvoker } from '@executor-js/execution/core'
import { ToolInvocationError } from '@executor-js/sdk/core'
import { describe, expect, it } from 'vitest'

/**
 * Proves that the patched Executor keeps an MCP provider failure on the
 * expected-result path. The provider message must reach Garden so the chat
 * can show the real Decide failure instead of an opaque internal error.
 */
describe('Executor MCP provider failures', () => {
  it('returns the nested MCP error as a tool result', async () => {
    const executor = {
      execute: () =>
        Effect.fail(
          new ToolInvocationError({
            address: 'tools.decide.user.decide.analyze' as never,
            message: 'MCP tool call failed for analyze',
            cause: {
              _tag: 'McpInvocationError',
              toolName: 'analyze',
              status: 402,
              mcpCode: -32603,
              message: 'Not enough Decide credits to run this request.',
            },
          }),
        ),
    } as never

    const invoker = makeExecutorToolInvoker(executor, {
      invokeOptions: {},
    })
    const result = await Effect.runPromise(
      invoker.invoke({
        path: 'decide.user.decide.analyze',
        args: {},
      }),
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'mcp_tool_error',
        message: 'Not enough Decide credits to run this request.',
        details: { toolName: 'analyze', status: 402, mcpCode: -32603 },
      },
    })
  })
})
