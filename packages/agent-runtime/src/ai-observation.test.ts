import type { ChatResponseResult, TurnContext } from '@cloudflare/think'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { AiObservation } from './ai-observation'

const analytics = vi.hoisted(() => ({
  captureEvent: vi.fn<
    (
      env: unknown,
      input: { event: string; properties: Record<string, unknown> },
    ) => Promise<void>
  >(async () => undefined),
  captureException: vi.fn<
    (env: unknown, input: Record<string, unknown>) => Promise<void>
  >(async () => undefined),
}))

vi.mock('@garden/observability/analytics/client', () => ({
  captureGardenAnalyticsEvent: analytics.captureEvent,
  captureGardenAnalyticsException: analytics.captureException,
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** Creates the smallest Durable Object state needed to flush captured events. */
function observationHarness() {
  const pending: Promise<unknown>[] = []
  const durableState = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as unknown as DurableObjectState
  return {
    observation: new AiObservation(durableState, {}),
    flush: async () => await Promise.all(pending),
  }
}

describe('AiObservation phase timing', () => {
  it('emits a child span and copies phase duration onto the final trace', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'))
    const harness = observationHarness()
    harness.observation.startTurn(
      {
        runtimeKind: 'chat',
        distinctId: 'user-1',
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        threadId: 'thread-1',
        sessionId: 'chat:thread-1',
      },
      {
        body: {},
        messages: [],
        system: 'System',
      } as unknown as TurnContext,
    )

    const phase = harness.observation.startPhase('mcp_prepare')
    vi.advanceTimersByTime(1_250)
    harness.observation.finishPhase(phase, {
      properties: { connector_count: 1 },
    })
    harness.observation.finishTurn({
      continuation: false,
      message: { role: 'assistant', content: 'Done' },
      requestId: 'request-1',
      status: 'completed',
    } as unknown as ChatResponseResult)
    await harness.flush()

    const events = analytics.captureEvent.mock.calls.map(([, input]) => input)
    const phaseSpan = events.find(
      (input) =>
        input.event === GARDEN_ANALYTICS_EVENTS.aiSpan &&
        input.properties.$ai_span_name === 'phase:mcp_prepare',
    )
    expect(phaseSpan?.properties).toMatchObject({
      $ai_latency: 1.25,
      connector_count: 1,
      duration_ms: 1_250,
      phase: 'mcp_prepare',
    })

    const trace = events.find(
      (input) => input.event === GARDEN_ANALYTICS_EVENTS.aiTrace,
    )
    expect(trace?.properties).toMatchObject({ timing_mcp_prepare_ms: 1_250 })
  })
})
