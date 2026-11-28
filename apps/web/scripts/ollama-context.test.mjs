import { describe, expect, it } from 'vitest'
import { checkOllamaContext } from './ollama-context.mjs'

const ollama = ({ contextLength, version = '0.40.16' }) => {
  const calls = []
  const fetchImpl = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    const body = url.endsWith('/api/version')
      ? { version }
      : url.endsWith('/api/ps')
        ? {
            models: [
              {
                name: 'qwen3:8b',
                model: 'qwen3:8b',
                context_length: contextLength,
              },
            ],
          }
        : {}
    return Promise.resolve(new Response(JSON.stringify(body)))
  }
  return { calls, fetchImpl }
}

describe('checkOllamaContext', () => {
  it('warns with the fix when Ollama runs a smaller context than Garden expects', async () => {
    const { calls, fetchImpl } = ollama({ contextLength: 4096 })
    const warning = await checkOllamaContext({}, fetchImpl)

    expect(warning).toContain('4096-token context; Garden expects 32768')
    expect(warning).toContain('OLLAMA_CONTEXT_LENGTH=32768 ollama serve')
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET http://localhost:11434/api/version',
      'POST http://localhost:11434/api/generate',
      'GET http://localhost:11434/api/ps',
    ])
  })

  it('stays quiet when the loaded context covers the configured window', async () => {
    const { fetchImpl } = ollama({ contextLength: 32768 })
    await expect(checkOllamaContext({}, fetchImpl)).resolves.toBeNull()
  })

  it('compares against GARDEN_MODEL_CONTEXT_WINDOW_TOKENS', async () => {
    const { fetchImpl } = ollama({ contextLength: 32768 })
    const warning = await checkOllamaContext(
      { GARDEN_MODEL_CONTEXT_WINDOW_TOKENS: '65536' },
      fetchImpl,
    )
    expect(warning).toContain('Garden expects 65536')
  })

  it('skips servers that are not Ollama or not reachable', async () => {
    const notOllama = () =>
      Promise.resolve(new Response('nope', { status: 404 }))
    const unreachable = () => Promise.reject(new TypeError('fetch failed'))

    await expect(
      checkOllamaContext(
        { GARDEN_MODEL_BASE_URL: 'https://api.example.com/v1' },
        notOllama,
      ),
    ).resolves.toBeNull()
    await expect(checkOllamaContext({}, unreachable)).resolves.toBeNull()
  })

  it('skips the check for the Workers AI provider', async () => {
    const { calls, fetchImpl } = ollama({ contextLength: 4096 })
    await expect(
      checkOllamaContext({ GARDEN_MODEL_PROVIDER: 'workers-ai' }, fetchImpl),
    ).resolves.toBeNull()
    expect(calls).toEqual([])
  })
})
