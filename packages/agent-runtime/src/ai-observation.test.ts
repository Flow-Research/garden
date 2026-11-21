import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatRequestContext,
  ChatResponseResult,
  ToolCallContext,
  ToolCallResultContext,
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
const context = (text: string): Parameters<AiObservation['startTurn']>[1] => ({
  messages: [{ role: 'user', content: text }],
  system: '',
  body: {},
})
// Typed without a cast, so a required context field cannot go missing here.
const request: ChatRequestContext = {
  version: 1,
  requestId: 'request',
  rootRequestId: 'request',
  source: { kind: 'unattributed' },
}
const toolCall: ToolCallContext = {
  type: 'tool-call',
  dynamic: true,
  toolCallId: 'call',
  toolName: 'external',
  input: { text: 'REVOKED_PRIVATE_TOOL' },
  request,
  stepNumber: 0,
  messages: [],
  abortSignal: undefined,
}
const toolCallResult: ToolCallResultContext = {
  type: 'tool-call',
  dynamic: true,
  toolCallId: 'call',
  toolName: 'external',
  input: {},
  output: 'REVOKED_PRIVATE_OUTPUT',
  success: true,
  durationMs: 1,
  request,
  stepNumber: 0,
  messages: [],
}
const result = (text: string): ChatResponseResult => ({
  status: 'completed',
  requestId: 'request',
  continuation: false,
  message: {
    id: 'output',
    role: 'assistant',
    parts: [{ type: 'text', text }],
  },
})

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
    } satisfies Pick<DurableObjectState, 'waitUntil'>
    return {
      value: new AiObservation(durable, {}),
      drain: () => Promise.all(pending),
    }
  }

  it('discards retained input and pending tool spans without a later flush leak', async () => {
    const { value, drain } = observer()
    value.startTurn(identity, context('REVOKED_PRIVATE_INPUT'))
    expect(value.modelTracing()?.privacyMode).toBe(true)
    value.beforeToolCall(toolCall)
    value.discardTurn()
    value.afterToolCall(toolCallResult)
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
