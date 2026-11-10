import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatResponseResult,
  ToolCallContext,
  ToolCallResultContext,
  TurnContext,
} from '@cloudflare/think'
import { AiObservation, type AiTurnIdentity } from './ai-observation'

const { captured } = vi.hoisted(() => ({ captured: [] as unknown[] }))
vi.mock('@garden/observability/analytics/client', () => ({
  captureGardenAnalyticsEvent: async (_env: unknown, event: unknown) => {
    captured.push(event)
  },
  captureGardenAnalyticsException: async (_env: unknown, event: unknown) => {
    captured.push(event)
  },
}))

const identity: AiTurnIdentity = {
  runtimeKind: 'issue_run',
  agentId: 'agent',
  workspaceId: 'workspace',
  distinctId: 'owner',
  runId: 'run',
  sessionId: 'session',
}
const context = (text: string) =>
  ({
    messages: [{ id: 'input', role: 'user', parts: [{ type: 'text', text }] }],
    system: '',
    body: {},
  }) as unknown as TurnContext
const result = (text: string) =>
  ({
    status: 'completed',
    requestId: 'request',
    continuation: false,
    message: {
      id: 'output',
      role: 'assistant',
      parts: [{ type: 'text', text }],
    },
  }) as unknown as ChatResponseResult

beforeEach(() => {
  captured.length = 0
})

describe('final observation authority', () => {
  function observer() {
    const pending: Promise<unknown>[] = []
    const durable = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise)
      },
    } as unknown as DurableObjectState
    return {
      value: new AiObservation(durable, {}),
      drain: () => Promise.all(pending),
    }
  }

  it('discards retained input and pending tool spans without a later flush leak', async () => {
    const { value, drain } = observer()
    value.startTurn(identity, context('REVOKED_PRIVATE_INPUT'))
    expect(value.modelTracing()?.privacyMode).toBe(true)
    value.beforeToolCall({
      toolCallId: 'call',
      toolName: 'external',
      input: { text: 'REVOKED_PRIVATE_TOOL' },
      stepNumber: 0,
    } as ToolCallContext)
    value.discardTurn()
    value.afterToolCall({
      toolCallId: 'call',
      toolName: 'external',
      input: {},
      output: 'REVOKED_PRIVATE_OUTPUT',
      success: true,
      durationMs: 1,
      stepNumber: 0,
    } as ToolCallResultContext)
    value.finishTurn(result('REVOKED_PRIVATE_FINAL'))
    await drain()
    expect(captured).toHaveLength(0)
    expect(value.modelTracing()).toBeUndefined()

    value.startTurn(
      { ...identity, runId: 'new-run' },
      context('SAFE_NEW_INPUT'),
    )
    value.finishTurn(result('SAFE_NEW_OUTPUT'))
    await drain()
    expect(captured.length).toBeGreaterThan(0)
    expect(JSON.stringify(captured)).toContain('SAFE_NEW_OUTPUT')
    expect(JSON.stringify(captured)).not.toContain('REVOKED_PRIVATE')
  })

  it('retains authorized observations and the existing chat behavior', async () => {
    const { value, drain } = observer()
    value.startTurn(
      { ...identity, runtimeKind: 'chat', threadId: 'thread' },
      context('AUTHORIZED_INPUT'),
    )
    expect(value.modelTracing()?.privacyMode).toBe(false)
    value.finishTurn(result('AUTHORIZED_OUTPUT'))
    await drain()
    expect(JSON.stringify(captured)).toContain('AUTHORIZED_INPUT')
    expect(JSON.stringify(captured)).toContain('AUTHORIZED_OUTPUT')
    expect(value.modelTracing()).toBeUndefined()
  })
})
