import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createWorkersAISpy, createOpenAICompatibleSpy, withTracingSpy } =
  vi.hoisted(() => ({
    withTracingSpy: vi.fn(),
    createWorkersAISpy: vi.fn(),
    createOpenAICompatibleSpy: vi.fn(),
  }))

vi.mock('@posthog/ai/vercel', () => ({ withTracing: withTracingSpy }))
vi.mock('posthog-node', () => ({ PostHog: class {} }))

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
    withTracingSpy.mockReset()
    withTracingSpy.mockReturnValue({ id: 'traced' })
    createWorkersAISpy.mockReset()
    createWorkersAISpy.mockReturnValue(vi.fn(() => ({ id: 'model' })))
    createOpenAICompatibleSpy.mockReset()
    createOpenAICompatibleSpy.mockReturnValue(vi.fn(() => ({ id: 'local' })))
  })

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

  it('uses Workers AI directly when no gateway is configured', () => {
    const ai = {} as Ai

    createAgentModel({ ai })

    expect(createWorkersAISpy).toHaveBeenCalledWith({ binding: ai })
    expect(createOpenAICompatibleSpy).not.toHaveBeenCalled()
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
  })

  it('builds a zero-priced offline profile with env-driven window', () => {
    const profile = resolveAgentModelProfile({
      GARDEN_OFFLINE: '1',
      GARDEN_MODEL_CONTEXT_WINDOW_TOKENS: '131072',
    })

    expect(profile.provider).toBe('openai-compatible')
    expect(profile.contextWindowTokens).toBe(131072)
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
