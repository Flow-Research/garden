import type {
  ChatResponseResult,
  StepContext,
  ToolCallContext,
  ToolCallResultContext,
  TurnContext,
} from '@cloudflare/think'
import { Result } from 'better-result'
import {
  captureGardenAnalyticsEvent,
  captureGardenAnalyticsException,
} from '@garden/observability/analytics/client'
import {
  GARDEN_ANALYTICS_EVENTS,
  type GardenAnalyticsEventName,
} from '@garden/observability/analytics/events'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import type { AgentModelTracing } from './model'

type AiRuntimeEnv = {
  ENVIRONMENT?: string
  VITE_PUBLIC_POSTHOG_HOST?: string
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
}

type AiRuntimeKind = 'chat' | 'issue_run' | 'automation_run'

export type AiTurnIdentity = {
  agentId: string
  automationId?: string
  distinctId: string
  issueId?: string
  runId?: string
  runtimeKind: AiRuntimeKind
  sessionId: string
  threadId?: string
  traceId?: string
  workspaceId: string
}

type AiTurnState = AiTurnIdentity & {
  counts: { steps: number; toolErrors: number; tools: number }
  input: {
    body: TurnContext['body']
    messages: TurnContext['messages']
    system: TurnContext['system']
  }
  startedAtMs: number
  phaseDurationsMs: Record<string, number>
  phases: Map<
    string,
    {
      name: string
      spanId: string
      startedAtMs: number
    }
  >
  toolCalls: Map<
    string,
    {
      input: unknown
      spanId: string
      startedAtMs: number
      toolName: string
    }
  >
  traceId: string
  turnSpanId: string
}

const aiAnalyticsLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'posthog-ai',
})

function serializedError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause:
      error.cause instanceof Error ? serializedError(error.cause) : error.cause,
  }
}

function isFailedToolOutput(output: unknown) {
  return (
    output !== null &&
    typeof output === 'object' &&
    'ok' in output &&
    (output as { ok?: unknown }).ok === false
  )
}

/**
 * Adds Garden domain context around PostHog's official AI SDK 6 model wrapper.
 * The wrapper owns generation/stream/provider instrumentation; this class only
 * emits Think turn spans, executed-tool spans, lifecycle outcomes, feedback
 * metrics, and handled exceptions.
 */
export class AiObservation {
  private state: AiTurnState | null = null

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: AiRuntimeEnv,
  ) {}

  startTurn(
    identity: AiTurnIdentity,
    ctx: TurnContext,
    startedAtMs = Date.now(),
  ) {
    this.state = {
      ...identity,
      traceId: identity.traceId ?? crypto.randomUUID(),
      turnSpanId: crypto.randomUUID(),
      startedAtMs,
      input: { system: ctx.system, messages: ctx.messages, body: ctx.body },
      counts: { steps: 0, tools: 0, toolErrors: 0 },
      phaseDurationsMs: {},
      phases: new Map(),
      toolCalls: new Map(),
    }

    if (identity.runtimeKind === 'chat') {
      this.captureProduct(GARDEN_ANALYTICS_EVENTS.chatMessageSent, {
        input: this.state.input,
      })
    }
  }

  /**
   * Starts one named phase inside the active AI turn. The returned token keeps
   * overlapping phases independent and lets the final trace expose measured
   * setup costs without adding another telemetry system.
   */
  startPhase(name: string, startedAtMs = Date.now()) {
    const state = this.state
    if (!state) return null

    const token = crypto.randomUUID()
    state.phases.set(token, {
      name,
      spanId: crypto.randomUUID(),
      startedAtMs,
    })
    return token
  }

  /** Returns the token for an active named phase in the current turn. */
  activePhaseToken(name: string) {
    const state = this.state
    if (!state) return null

    for (const [token, phase] of state.phases) {
      if (phase.name === name) return token
    }
    return null
  }

  /** Completes a named phase and emits it as a child span of the active turn. */
  finishPhase(
    token: string | null,
    options: {
      error?: unknown
      properties?: Record<string, unknown>
    } = {},
  ) {
    const state = this.state
    if (!state || !token) return

    const phase = state.phases.get(token)
    if (!phase) return

    const durationMs = Math.max(0, Date.now() - phase.startedAtMs)
    state.phaseDurationsMs[phase.name] =
      (state.phaseDurationsMs[phase.name] ?? 0) + durationMs
    this.capture(GARDEN_ANALYTICS_EVENTS.aiSpan, state, {
      $ai_trace_id: state.traceId,
      $ai_session_id: state.sessionId,
      $ai_span_id: phase.spanId,
      $ai_span_name: `phase:${phase.name}`,
      $ai_parent_id: state.turnSpanId,
      $ai_latency: durationMs / 1_000,
      $ai_is_error: options.error !== undefined,
      $ai_error:
        options.error === undefined
          ? undefined
          : serializedError(options.error),
      duration_ms: durationMs,
      phase: phase.name,
      ...options.properties,
    })
    state.phases.delete(token)
  }

  modelTracing(): AgentModelTracing | undefined {
    const state = this.state
    if (!state) return undefined

    return {
      distinctId: state.distinctId,
      traceId: state.traceId,
      workspaceId: state.workspaceId,
      waitUntil: (promise) => this.durableState.waitUntil(promise),
      properties: {
        $ai_session_id: state.sessionId,
        garden_runtime_kind: state.runtimeKind,
        agent_id: state.agentId,
        thread_id: state.threadId,
        issue_id: state.issueId,
        run_id: state.runId,
        automation_id: state.automationId,
      },
    }
  }

  captureProduct(
    event: GardenAnalyticsEventName,
    properties: Record<string, unknown>,
  ) {
    if (this.state) this.capture(event, this.state, properties)
  }

  captureProductFor(
    identity: AiTurnIdentity,
    event: GardenAnalyticsEventName,
    properties: Record<string, unknown>,
  ) {
    this.capture(event, identity, properties)
  }

  beforeToolCall(ctx: ToolCallContext) {
    const state = this.state
    if (!state) return
    state.counts.tools += 1
    state.toolCalls.set(ctx.toolCallId, {
      input: ctx.input,
      spanId: crypto.randomUUID(),
      startedAtMs: Date.now(),
      toolName: ctx.toolName,
    })
  }

  afterToolCall(ctx: ToolCallResultContext) {
    const state = this.state
    if (!state) return

    const activeTool = state.toolCalls.get(ctx.toolCallId)
    const failed =
      !ctx.success || isFailedToolOutput(ctx.success ? ctx.output : null)
    if (failed) {
      state.counts.toolErrors += 1
      this.captureException(state, ctx.success ? ctx.output : ctx.error, {
        operation: 'ai_tool_call',
        tool_name: ctx.toolName,
        tool_call_id: ctx.toolCallId,
      })
    }

    const durationMs =
      ctx.durationMs ||
      (activeTool ? Date.now() - activeTool.startedAtMs : 0)
    state.phaseDurationsMs.tool_calls =
      (state.phaseDurationsMs.tool_calls ?? 0) + durationMs

    this.capture(GARDEN_ANALYTICS_EVENTS.aiSpan, state, {
      $ai_trace_id: state.traceId,
      $ai_session_id: state.sessionId,
      $ai_span_id: activeTool?.spanId ?? crypto.randomUUID(),
      $ai_span_name: `tool:${ctx.toolName}`,
      $ai_parent_id: state.turnSpanId,
      $ai_input_state: activeTool?.input ?? ctx.input,
      $ai_output_state: ctx.success ? ctx.output : undefined,
      $ai_latency: durationMs / 1_000,
      $ai_is_error: failed,
      $ai_error: ctx.success ? undefined : serializedError(ctx.error),
      tool_name: ctx.toolName,
      tool_call_id: ctx.toolCallId,
      step_number: ctx.stepNumber,
    })
    state.toolCalls.delete(ctx.toolCallId)
  }

  stepFinished(_ctx: StepContext) {
    if (this.state) this.state.counts.steps += 1
  }

  finishTurn(result: ChatResponseResult) {
    const state = this.state
    if (!state) return

    const durationMs = Date.now() - state.startedAtMs
    const output = {
      message: result.message,
      request_id: result.requestId,
      continuation: result.continuation,
      status: result.status,
    }
    const timingProperties = Object.fromEntries(
      Object.entries(state.phaseDurationsMs).map(([name, duration]) => [
        `timing_${name}_ms`,
        duration,
      ]),
    )
    aiAnalyticsLogger.info('ai.turn_timing', {
      traceId: state.traceId,
      sessionId: state.sessionId,
      status: result.status,
      totalDurationMs: durationMs,
      ...timingProperties,
    })
    this.capture(GARDEN_ANALYTICS_EVENTS.aiSpan, state, {
      $ai_trace_id: state.traceId,
      $ai_session_id: state.sessionId,
      $ai_span_id: state.turnSpanId,
      $ai_span_name: `${state.runtimeKind}_turn`,
      $ai_input_state: state.input,
      $ai_output_state: output,
      $ai_latency: durationMs / 1_000,
      $ai_is_error: result.status === 'error',
      $ai_error:
        result.status === 'error' ? serializedError(result.error) : undefined,
      ...timingProperties,
    })
    this.capture(GARDEN_ANALYTICS_EVENTS.aiTrace, state, {
      $ai_trace_id: state.traceId,
      $ai_session_id: state.sessionId,
      $ai_span_name: `garden_${state.runtimeKind}`,
      $ai_trace_name: `garden_${state.runtimeKind}`,
      $ai_input_state: state.input,
      $ai_output_state: output,
      $ai_latency: durationMs / 1_000,
      $ai_is_error: result.status === 'error',
      $ai_error:
        result.status === 'error' ? serializedError(result.error) : undefined,
      terminal_status: result.status,
      step_count: state.counts.steps,
      tool_call_count: state.counts.tools,
      tool_error_count: state.counts.toolErrors,
      ...timingProperties,
    })

    if (state.runtimeKind === 'chat') {
      this.capture(
        result.status === 'completed'
          ? GARDEN_ANALYTICS_EVENTS.chatResponseCompleted
          : GARDEN_ANALYTICS_EVENTS.chatResponseFailed,
        state,
        {
          response: result.message,
          request_id: result.requestId,
          status: result.status,
          duration_ms: durationMs,
          step_count: state.counts.steps,
          tool_call_count: state.counts.tools,
          ...timingProperties,
        },
      )
    }
    if (result.status === 'error') {
      this.captureException(state, result.error, {
        operation: 'ai_turn',
        status: result.status,
      })
    }

    const metrics: ReadonlyArray<readonly [string, boolean | number | string]> =
      [
        ['garden.turn_success', result.status === 'completed'],
        ['garden.step_count', state.counts.steps],
        ['garden.tool_call_count', state.counts.tools],
        ['garden.tool_error_count', state.counts.toolErrors],
        ['garden.run_outcome', result.status],
      ]
    for (const [name, value] of metrics) {
      this.capture(GARDEN_ANALYTICS_EVENTS.aiMetric, state, {
        $ai_trace_id: state.traceId,
        $ai_session_id: state.sessionId,
        $ai_metric_name: name,
        $ai_metric_value: value,
      })
    }

    this.state = null
  }

  private captureException(
    state: AiTurnState,
    error: unknown,
    properties: Record<string, unknown>,
  ) {
    const promise = Result.tryPromise({
      try: async () =>
        await captureGardenAnalyticsException(this.env, {
          distinctId: state.distinctId,
          error,
          workspaceId: state.workspaceId,
          properties: {
            $ai_trace_id: state.traceId,
            $ai_session_id: state.sessionId,
            ...properties,
            ...this.domainProperties(state),
          },
        }),
      catch: (cause) => cause,
    }).then((result) => {
      if (result.isErr()) {
        aiAnalyticsLogger.warn('posthog.ai_exception_capture_failed', {
          traceId: state.traceId,
          ...errorFields(result.error),
        })
      }
    })
    this.durableState.waitUntil(promise)
  }

  private capture(
    event: GardenAnalyticsEventName,
    state: AiTurnIdentity,
    properties: Record<string, unknown>,
  ) {
    const promise = Result.tryPromise({
      try: async () =>
        await captureGardenAnalyticsEvent(this.env, {
          distinctId: state.distinctId,
          event,
          workspaceId: state.workspaceId,
          properties: { ...properties, ...this.domainProperties(state) },
        }),
      catch: (cause) => cause,
    }).then((result) => {
      if (result.isErr()) {
        aiAnalyticsLogger.warn('posthog.ai_capture_failed', {
          event,
          traceId: state.traceId,
          ...errorFields(result.error),
        })
      }
    })
    this.durableState.waitUntil(promise)
  }

  private domainProperties(state: AiTurnIdentity) {
    return {
      garden_runtime_kind: state.runtimeKind,
      workspace_id: state.workspaceId,
      agent_id: state.agentId,
      thread_id: state.threadId,
      issue_id: state.issueId,
      run_id: state.runId,
      automation_id: state.automationId,
    }
  }
}
