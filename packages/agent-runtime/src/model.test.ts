import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { captureAiGeneration } from '@posthog/ai'

const {
  createWorkersAISpy,
  createOpenAICompatibleSpy,
  withTracingSpy,
  telemetryEvents,
  capturedExceptions,
} = vi.hoisted(() => ({
  telemetryEvents: [] as unknown[],
  capturedExceptions: [] as unknown[],
  withTracingSpy: vi.fn(),
  createWorkersAISpy: vi.fn(),
  createOpenAICompatibleSpy: vi.fn(),
}))

vi.mock('@posthog/ai/vercel', () => ({ withTracing: withTracingSpy }))
vi.mock('posthog-node', () => ({
  PostHog: class {
    privacy_mode = false
    constructor(
      _token: string,
      readonly options: {
        enableExceptionAutocapture?: boolean
        before_send?: (event: {
          event: string
          properties?: Record<string, unknown>
        }) => unknown
      },
    ) {}
    capture(event: { event: string; properties?: Record<string, unknown> }) {
      const outgoing = this.options.before_send
        ? this.options.before_send(event)
        : event
      if (outgoing) telemetryEvents.push(outgoing)
    }
    captureException(error: unknown) {
      capturedExceptions.push(error)
    }
  },
}))

vi.mock('workers-ai-provider', () => ({
  createWorkersAI: createWorkersAISpy,
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: createOpenAICompatibleSpy,
}))

import {
  DEFAULT_AGENT_MODEL_PROFILE,
  createAgentModel,
  resolveAgentModelProfile,
} from './model'

describe('createAgentModel', () => {
  beforeEach(() => {
    telemetryEvents.length = 0
    capturedExceptions.length = 0
    withTracingSpy.mockReset()
    withTracingSpy.mockReturnValue({ id: 'traced' })
    createWorkersAISpy.mockReset()
    createWorkersAISpy.mockReturnValue(vi.fn(() => ({ id: 'model' })))
    createOpenAICompatibleSpy.mockReset()
    createOpenAICompatibleSpy.mockReturnValue(vi.fn(() => ({ id: 'local' })))
  })

  it.each(['generate', 'stream'] as const)(
    'records V4 %s usage and protects private content',
    async (mode) => {
      const usage = {
        inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 2, reasoning: 0 },
      }
      const finishReason = { unified: 'stop' as const, raw: 'stop' }
      const source = new MockLanguageModelV4({
        doGenerate: {
          content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }],
          finishReason,
          usage,
          warnings: [],
        },
        doStream: {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: 'text-delta',
                id: 'text',
                delta: 'PRIVATE_OUTPUT',
              })
              controller.enqueue({ type: 'finish', finishReason, usage })
              controller.close()
            },
          }),
        },
      })
      createWorkersAISpy.mockReturnValue(() => source)
      const pending: Promise<unknown>[] = []
      const model = createAgentModel({
        ai: {} as Ai,
        env: { VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: 'synthetic-test-token' },
        tracing: {
          distinctId: 'owner',
          traceId: 'trace',
          workspaceId: 'workspace',
          properties: {},
          waitUntil: (task) => {
            pending.push(task)
          },
          privacyMode: true,
        },
      })
      if (typeof model !== 'object' || model.specificationVersion !== 'v4')
        throw new Error('Expected V4 model')
      const call = {
        prompt: [{ role: 'system' as const, content: 'PRIVATE_PROMPT' }],
      }
      if (mode === 'generate') {
        expect((await model.doGenerate(call)).content[0]).toEqual({
          type: 'text',
          text: 'PRIVATE_OUTPUT',
        })
      } else {
        const { stream } = await model.doStream(call)
        const reader = stream.getReader()
        expect((await reader.read()).value).toMatchObject({
          type: 'text-delta',
          delta: 'PRIVATE_OUTPUT',
        })
        expect((await reader.read()).value).toMatchObject({ type: 'finish' })
        expect((await reader.read()).done).toBe(true)
      }
      await Promise.all(pending)
      expect(telemetryEvents).toHaveLength(1)
      expect(telemetryEvents[0]).toMatchObject({
        event: '$ai_generation',
        properties: {
          $ai_trace_id: 'trace',
          $ai_input_tokens: 7,
          $ai_output_tokens: 2,
          workspace_id: 'workspace',
        },
      })
      expect(JSON.stringify(telemetryEvents)).not.toMatch(
        /PRIVATE_(PROMPT|OUTPUT)/,
      )
    },
  )

  it.each(['generate', 'stream'] as const)(
    'bounds public %s telemetry and keeps tool call identity',
    async (mode) => {
      const prompt = '界'.repeat(500_000)
      const toolCall = {
        type: 'tool-call' as const,
        toolCallId: 'call1',
        toolName: 'lookup',
        input: '{"item":"report"}',
      }
      const usage = {
        inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 2, reasoning: 0 },
      }
      const finishReason = { unified: 'tool-calls' as const, raw: 'tool-calls' }
      const source = new MockLanguageModelV4({
        doGenerate: { content: [toolCall], finishReason, usage, warnings: [] },
        doStream: {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(toolCall)
              controller.enqueue({ type: 'finish', finishReason, usage })
              controller.close()
            },
          }),
        },
      })
      createWorkersAISpy.mockReturnValue(() => source)
      const pending: Promise<unknown>[] = []
      const model = createAgentModel({
        ai: {} as Ai,
        env: { VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: 'synthetic-test-token' },
        tracing: {
          distinctId: 'owner',
          traceId: 'trace',
          workspaceId: 'workspace',
          properties: {},
          privacyMode: false,
          waitUntil: (task) => {
            pending.push(task)
          },
        },
      })
      if (typeof model !== 'object' || model.specificationVersion !== 'v4')
        throw new Error('Expected V4 model')
      const call = { prompt: [{ role: 'system' as const, content: prompt }] }
      if (mode === 'generate') {
        expect((await model.doGenerate(call)).content).toEqual([toolCall])
        expect(source.doGenerateCalls[0]?.prompt).toEqual(call.prompt)
      } else {
        const reader = (await model.doStream(call)).stream.getReader()
        expect((await reader.read()).value).toEqual(toolCall)
        await reader.read()
        await reader.read()
        expect(source.doStreamCalls[0]?.prompt).toEqual(call.prompt)
      }
      await Promise.all(pending)
      expect(telemetryEvents).toHaveLength(1)
      expect(
        new TextEncoder().encode(JSON.stringify(telemetryEvents)).length,
      ).toBeLessThan(20 * 1024)
      expect(telemetryEvents[0]).toMatchObject({
        properties: {
          $ai_input_tokens: 7,
          $ai_output_choices: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  id: 'call1',
                  function: { name: 'lookup', arguments: toolCall.input },
                },
              ],
            },
          ],
        },
      })
      expect(JSON.stringify(telemetryEvents)).toContain('[truncated]')
    },
  )

  it.each([true, false, undefined])(
    'passes content privacy to the generation adapter: %s',
    (privacyMode) => {
      createAgentModel({
        ai: {} as Ai,
        env: { VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: 'synthetic-test-token' },
        tracing: {
          distinctId: 'owner',
          traceId: 'trace',
          workspaceId: 'workspace',
          properties: {},
          waitUntil: () => {},
          privacyMode,
        },
      })
      expect(withTracingSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ posthogPrivacyMode: privacyMode ?? false }),
      )
    },
  )

  it.each([true, false])(
    'keeps generation error content private=%s through the real SDK capture primitive',
    async (privacyMode) => {
      createAgentModel({
        ai: {} as Ai,
        env: { VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: 'synthetic-test-token' },
        tracing: {
          distinctId: 'owner',
          traceId: 'trace',
          workspaceId: 'workspace',
          properties: {},
          waitUntil: () => {},
          privacyMode,
        },
      })
      const client = withTracingSpy.mock.calls[0]?.[1] as Parameters<
        typeof captureAiGeneration
      >[0]
      if (!client) throw new Error('Tracing client was not configured')
      await captureAiGeneration(client, {
        distinctId: 'owner',
        model: 'fixture',
        provider: 'fixture',
        privacyMode,
        input: 'PRIVATE_GENERATION_INPUT',
        output: [],
        latency: 0,
        error: new Error('PRIVATE_GENERATION_ERROR'),
        providerMetadata: { diagnostic: 'PRIVATE_PROVIDER_METADATA' },
        properties: {
          run_id: 'owned-run',
          diagnostic: 'PRIVATE_CUSTOM_PROPERTY',
        },
        usage: { inputTokens: 7, outputTokens: 2 },
      })
      expect(telemetryEvents).toHaveLength(1)
      const serialized = JSON.stringify(telemetryEvents)
      if (privacyMode) {
        expect(serialized).not.toContain('PRIVATE_')
        expect(serialized).toContain('Agent model request failed.')
        expect(capturedExceptions).toHaveLength(0)
        client.capture({
          distinctId: 'owner',
          event: '$exception',
          properties: { $exception_list: ['PRIVATE_EXCEPTION'] },
        })
        expect(telemetryEvents).toHaveLength(1)
      } else expect(serialized).toContain('PRIVATE_GENERATION_ERROR')
      expect(serialized).toContain('owned-run')
      expect(serialized).toContain('fixture')
    },
  )

  it('uses Workers AI directly when no gateway is configured', () => {
    const ai = {} as Ai

    createAgentModel({ ai })

    expect(createWorkersAISpy).toHaveBeenCalledWith({ binding: ai })
    expect(createOpenAICompatibleSpy).not.toHaveBeenCalled()
  })

  it('requests the default DeepSeek model at high reasoning effort', () => {
    const modelSpy = vi.fn(() => ({ id: 'model' }))
    createWorkersAISpy.mockReturnValue(modelSpy)

    createAgentModel({ ai: {} as Ai })

    expect(modelSpy).toHaveBeenCalledWith(
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      { reasoning_effort: 'high' },
    )
  })

  it('routes through the explicitly configured gateway', () => {
    const ai = {} as Ai

    createAgentModel({ ai, gatewayId: '  contributor-gateway  ' })

    expect(createWorkersAISpy).toHaveBeenCalledWith({
      binding: ai,
      gateway: { id: 'contributor-gateway' },
    })
  })

  it('uses the OpenAI-compatible provider with Ollama defaults in offline mode', () => {
    const ai = {} as Ai
    const modelSpy = vi.fn(() => ({ id: 'local' }))
    createOpenAICompatibleSpy.mockReturnValue(modelSpy)

    createAgentModel({ ai, env: { GARDEN_OFFLINE: '1' } })

    expect(createWorkersAISpy).not.toHaveBeenCalled()
    expect(createOpenAICompatibleSpy).toHaveBeenCalledWith({
      name: 'garden-openai-compatible',
      baseURL: 'http://localhost:11434/v1',
      includeUsage: true,
    })
    expect(modelSpy).toHaveBeenCalledWith('qwen3:8b')
  })

  it('passes explicit endpoint, model id, and api key through unchanged', () => {
    const ai = {} as Ai
    const modelSpy = vi.fn(() => ({ id: 'hosted' }))
    createOpenAICompatibleSpy.mockReturnValue(modelSpy)

    createAgentModel({
      ai,
      env: {
        GARDEN_MODEL_PROVIDER: 'openai-compatible',
        GARDEN_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
        GARDEN_MODEL_ID: 'qwen/qwen3-coder',
        GARDEN_MODEL_API_KEY: 'sk-or-test',
      },
    })

    expect(createOpenAICompatibleSpy).toHaveBeenCalledWith({
      name: 'garden-openai-compatible',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test',
      includeUsage: true,
    })
    expect(modelSpy).toHaveBeenCalledWith('qwen/qwen3-coder')
  })

  it('lets an explicit workers-ai provider override the offline switch', () => {
    const ai = {} as Ai

    createAgentModel({
      ai,
      env: { GARDEN_OFFLINE: '1', GARDEN_MODEL_PROVIDER: 'workers-ai' },
    })

    expect(createWorkersAISpy).toHaveBeenCalledWith({ binding: ai })
    expect(createOpenAICompatibleSpy).not.toHaveBeenCalled()
  })
})

describe('resolveAgentModelProfile', () => {
  it('returns the Workers AI default profile with no env', () => {
    expect(resolveAgentModelProfile()).toBe(DEFAULT_AGENT_MODEL_PROFILE)
    expect(resolveAgentModelProfile({})).toBe(DEFAULT_AGENT_MODEL_PROFILE)
    expect(DEFAULT_AGENT_MODEL_PROFILE.maxOutputTokens).toBe(16_000)
  })

  it('builds a zero-priced offline profile with env-driven window', () => {
    const profile = resolveAgentModelProfile({
      GARDEN_OFFLINE: '1',
      GARDEN_MODEL_CONTEXT_WINDOW_TOKENS: '131072',
    })

    expect(profile.provider).toBe('openai-compatible')
    expect(profile.contextWindowTokens).toBe(131072)
    expect(profile.maxOutputTokens).toBe(16_000)
    expect(profile.pricePerToken).toEqual({
      input: 0,
      output: 0,
      cacheReadInput: 0,
    })
    expect(profile.compaction.responseReserveTokens).toBe(16_384)
    expect(profile.compaction.tailTokenBudgetTokens).toBe(20_000)
  })

  it('keeps the compaction threshold positive for small context windows', () => {
    const profile = resolveAgentModelProfile({
      GARDEN_OFFLINE: '1',
      GARDEN_MODEL_CONTEXT_WINDOW_TOKENS: '8192',
    })

    expect(profile.compaction.responseReserveTokens).toBe(1024)
    expect(profile.compaction.tailTokenBudgetTokens).toBe(2048)
    expect(profile.compaction.thresholdTokens).toBe(8192 - 1024)
    expect(profile.compaction.thresholdTokens).toBeGreaterThan(0)
  })

  it('falls back to the 32k default window on invalid input', () => {
    const profile = resolveAgentModelProfile({
      GARDEN_OFFLINE: '1',
      GARDEN_MODEL_CONTEXT_WINDOW_TOKENS: 'not-a-number',
    })

    expect(profile.contextWindowTokens).toBe(32_768)
  })
})
