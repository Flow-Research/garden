import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionEngine } from '@executor-js/execution/core'

vi.mock('agents/mcp', () => ({
  McpAgent: class {
    getSessionId() {
      return 'session-test'
    }
  },
}))

import { McpAgentSessionDOBase } from '@executor-js/cloudflare/mcp/agent-durable-object'

const engine: ExecutionEngine<never> = {
  execute: () => Effect.succeed({ result: 'ok' }),
  executeWithPause: () =>
    Effect.succeed({ status: 'completed', result: { result: 'ok' } }),
  resume: () => Effect.succeed(null),
  getPausedExecution: () => Effect.succeed(null),
  pausedExecutionCount: () => Effect.succeed(0),
  hasPausedExecutions: () => Effect.succeed(false),
  getDescription: Effect.succeed('test executor'),
}

type HibernationHarness = {
  dbHandle: { readonly end: () => void } | null
  engine: ExecutionEngine<never> | null
  getConnections: () => Iterable<{ close: () => void }>
  initialized: boolean
  onStart: () => Promise<void>
  onStartPromise: Promise<void> | null
  pendingApprovalLeases: Map<string, never>
  runMcpAgentOnStart: () => Promise<void>
}

/** Creates the upstream base in the same cold/warm states its own tests use. */
const makeHarness = (warm: boolean) => {
  const session = Object.create(
    McpAgentSessionDOBase.prototype,
  ) as HibernationHarness
  let closeCalls = 0
  session.dbHandle = null
  session.engine = warm ? engine : null
  session.initialized = warm
  session.onStartPromise = null
  session.pendingApprovalLeases = new Map()
  session.getConnections = () => [
    {
      close: () => {
        closeCalls += 1
      },
    },
  ]
  session.runMcpAgentOnStart = async () => {
    session.engine = engine
    session.initialized = true
  }
  return { session, closeCalls: () => closeCalls }
}

describe('Executor MCP hibernation restore', () => {
  it('preserves hibernated response streams on cold isolate start', async () => {
    const harness = makeHarness(false)

    await harness.session.onStart()

    expect(harness.closeCalls()).toBe(0)
    expect(harness.session.initialized).toBe(true)
  })

  it('closes stale streams when an in-memory runtime restarts', async () => {
    const harness = makeHarness(true)

    await harness.session.onStart()

    expect(harness.closeCalls()).toBe(1)
    expect(harness.session.initialized).toBe(true)
  })
})
