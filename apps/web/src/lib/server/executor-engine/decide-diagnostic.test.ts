import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { diagnoseDecideWithExecutor } from './decide-diagnostic'

const decideTool = {
  address: 'tools.decide.user.decide.whoami',
  name: 'whoami',
  integration: 'decide',
}

const makeExecutor = (
  execute: (address: unknown) => Effect.Effect<unknown, unknown>,
) =>
  ({
    integrations: { list: () => Effect.succeed([]) },
    connections: {
      list: () =>
        Effect.succeed([
          { integration: 'decide', name: 'default', owner: 'user' },
        ]),
    },
    tools: {
      list: () => Effect.succeed([decideTool]),
    },
    execute,
  }) as never

describe('Decide diagnostic', () => {
  it('passes when the live whoami call succeeds without returning identity data', async () => {
    const result = await Effect.runPromise(
      diagnoseDecideWithExecutor(
        makeExecutor(() =>
          Effect.succeed({ ok: true, data: { email: 'private@example.com' } }),
        ),
      ),
    )

    expect(result.outcome).toBe('passed')
    expect(result.checks.at(-1)).toEqual({
      name: 'call',
      outcome: 'passed',
      stage: 'tool_call',
      message: 'Decide whoami returned successfully.',
    })
    expect(JSON.stringify(result)).not.toContain('private@example.com')
  })

  it('preserves a nested Decide error and identifies the MCP handoff stage', async () => {
    const result = await Effect.runPromise(
      diagnoseDecideWithExecutor(
        makeExecutor(() =>
          Effect.fail({
            _tag: 'ToolInvocationError',
            message: 'MCP tool call failed for whoami',
            cause: {
              _tag: 'McpInvocationError',
              toolName: 'whoami',
              mcpCode: -32603,
              message: 'Internal tool error [f0c1bf7b]',
            },
          }),
        ),
      ),
    )

    expect(result.outcome).toBe('failed')
    expect(result.checks.at(-1)).toMatchObject({
      name: 'call',
      outcome: 'failed',
      stage: 'mcp_handoff',
      message: 'Internal tool error [f0c1bf7b]',
      mcpCode: -32603,
      correlationId: 'f0c1bf7b',
    })
  })

  it('reports a missing whoami tool separately from a failed call', async () => {
    const executor = makeExecutor(() => Effect.succeed({ ok: true })) as {
      tools: { list: () => Effect.Effect<unknown[], never> }
    }
    executor.tools.list = () => Effect.succeed([])

    const result = await Effect.runPromise(
      diagnoseDecideWithExecutor(executor as never),
    )

    expect(result.checks.at(-1)).toMatchObject({
      name: 'tool',
      outcome: 'failed',
      stage: 'tool_lookup',
    })
  })

  it('keeps catalog failures at the catalog stage', async () => {
    const executor = makeExecutor(() => Effect.succeed({ ok: true })) as {
      integrations: {
        list: () => Effect.Effect<never, unknown>
      }
    }
    executor.integrations.list = () =>
      Effect.fail({
        _tag: 'CatalogUnavailable',
        message: 'Executor catalog is unavailable.',
      })

    const result = await Effect.runPromise(
      diagnoseDecideWithExecutor(executor as never),
    )

    expect(result.checks.at(-1)).toMatchObject({
      name: 'catalog',
      outcome: 'failed',
      stage: 'catalog',
      message: 'Executor catalog is unavailable.',
    })
  })
})
