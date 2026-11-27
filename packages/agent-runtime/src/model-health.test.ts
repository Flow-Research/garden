import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_MODEL_PROFILE } from './model'
import { probeAgentModel, settleBefore } from './model-health'

// The Workers AI binding is the provider boundary: `createAgentModel` builds
// the real workers-ai-provider model around it, so these tests exercise the
// same request path agent turns use.
function workersAi(run: (model: string, inputs: unknown) => Promise<unknown>) {
  const binding = { run: vi.fn(run) } as { run: ReturnType<typeof vi.fn> } & Ai
  return { binding, ai: binding }
}

const probe = (ai: Ai, overrides: { timeoutMs?: number } = {}) =>
  probeAgentModel({ ai, env: {}, timeoutMs: overrides.timeoutMs ?? 1_000 })

afterEach(() => {
  vi.unstubAllGlobals()
})

it('consumes a provider failure when the timeout signal already fired', async () => {
  const reason = new Error('deadline')
  const work = Promise.reject(new Error('provider closed'))
  const observe = vi.spyOn(work, 'then')
  await expect(settleBefore(AbortSignal.abort(reason), work)).rejects.toBe(
    reason,
  )
  expect(observe).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(Function),
  )
})

describe('probeAgentModel', () => {
  it('reports healthy when the configured model answers', async () => {
    const { ai, binding } = workersAi(async () => ({ response: 'OK' }))

    const report = await probe(ai)

    expect(report).toMatchObject({
      status: 'healthy',
      provider: 'workers-ai',
      modelId: DEFAULT_AGENT_MODEL_PROFILE.id,
      finishReason: 'stop',
    })
    expect(report.detail).toBeUndefined()
    expect(binding.run).toHaveBeenCalledOnce()
    expect(binding.run.mock.calls[0]?.[0]).toBe(DEFAULT_AGENT_MODEL_PROFILE.id)
  })

  it('reports an empty answer as invalid, not healthy', async () => {
    const { ai } = workersAi(async () => ({ response: '   ' }))

    const report = await probe(ai)

    expect(report.status).toBe('invalid_response')
    expect(report.detail).toBe('The model returned no text.')
  })

  it('reports an answer that finished with an error as invalid', async () => {
    const { ai } = workersAi(async () => ({
      choices: [{ message: { content: 'OK' }, finish_reason: 'error' }],
    }))

    const report = await probe(ai)

    expect(report.status).toBe('invalid_response')
  })

  it('reports a retired Workers AI model as unavailable', async () => {
    const { ai } = workersAi(async () => {
      throw new Error(
        'AiError: Model has been deprecated: @cf/zai-org/glm-5.3 was deprecated on 2026-11-20.',
      )
    })

    const report = await probe(ai)

    expect(report.status).toBe('unavailable')
    expect(report.detail).toBe('Model request failed.')
  })

  it('reports other provider failures as provider_error without retrying', async () => {
    const { ai, binding } = workersAi(async () => {
      throw new Error('AiError: 3040: Capacity temporarily exceeded')
    })

    const report = await probe(ai)

    expect(report.status).toBe('provider_error')
    expect(report.detail).toBe('Model request failed.')
    expect(binding.run).toHaveBeenCalledOnce()
  })

  it('times out a provider that never answers', async () => {
    const { ai } = workersAi(() => new Promise(() => {}))

    const report = await probe(ai, { timeoutMs: 20 })

    expect(report.status).toBe('timeout')
    expect(report.detail).toBe('No answer within 20 ms.')
    expect(report.durationMs).toBeGreaterThanOrEqual(15)
  })

  it('reports a missing AI binding as a configuration error', async () => {
    const report = await probeAgentModel({
      // AppEnv types `AI` as bound; a misdeployed Worker can still lack it.
      ai: undefined as never,
      env: {},
      timeoutMs: 1_000,
    })

    expect(report.status).toBe('configuration_error')
    expect(report.provider).toBe('workers-ai')
  })

  describe('openai-compatible provider', () => {
    const env = {
      GARDEN_MODEL_PROVIDER: 'openai-compatible',
      GARDEN_MODEL_BASE_URL: 'https://models.example.test/v1',
      GARDEN_MODEL_ID: 'example/model',
      GARDEN_MODEL_API_KEY: 'sk-test-secret',
    }
    const unusedAi = workersAi(async () => ({ response: 'unused' })).ai

    function stubProvider(status: number, body: unknown) {
      const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
        Response.json(body, { status }),
      )
      vi.stubGlobal('fetch', fetch)
      return fetch
    }

    it('probes the configured model id', async () => {
      const fetch = stubProvider(200, {
        id: 'r1',
        object: 'chat.completion',
        created: 0,
        model: 'example/model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK' },
            finish_reason: 'stop',
          },
        ],
      })

      const report = await probeAgentModel({
        ai: unusedAi,
        env,
        timeoutMs: 1_000,
      })

      expect(report).toMatchObject({
        status: 'healthy',
        provider: 'openai-compatible',
        modelId: 'example/model',
      })
      const [url, init] = fetch.mock.calls[0] ?? []
      expect(url).toBe('https://models.example.test/v1/chat/completions')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'example/model',
      })
    })

    it('reports a missing model as unavailable', async () => {
      stubProvider(404, { error: { message: 'model not found' } })

      const report = await probeAgentModel({
        ai: unusedAi,
        env,
        timeoutMs: 1_000,
      })

      expect(report.status).toBe('unavailable')
      expect(report.detail).toContain('HTTP 404')
    })

    it('reports a rejected API key as a configuration error without leaking it', async () => {
      stubProvider(401, {
        error: { message: 'invalid api key: sk-test-secret' },
      })

      const report = await probeAgentModel({
        ai: unusedAi,
        env,
        timeoutMs: 1_000,
      })

      expect(report.status).toBe('configuration_error')
      expect(report.detail).not.toContain('sk-test-secret')
    })
  })
})
