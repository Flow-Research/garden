const DEFAULT_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_MODEL_ID = 'qwen3:8b'
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768

/**
 * Warns when Ollama serves the offline model with a smaller context than
 * Garden plans for. Ollama's OpenAI-compatible endpoint cannot take a context
 * size per request, and its default is 4096 tokens, so Garden's ~11k-token
 * first turn is silently cut down ("truncating input prompt" in Ollama's log)
 * and the model never sees most instructions or tools.
 * https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-specify-the-context-window-size
 *
 * Resolves to a warning string, or null when the server is not Ollama, is not
 * reachable, or already has enough context. Never rejects.
 */
export function checkOllamaContext(env, fetchImpl = fetch) {
  const provider = env.GARDEN_MODEL_PROVIDER?.trim()
  if (provider && provider !== 'openai-compatible') return Promise.resolve(null)

  const baseUrl = env.GARDEN_MODEL_BASE_URL?.trim() || DEFAULT_BASE_URL
  const model = env.GARDEN_MODEL_ID?.trim() || DEFAULT_MODEL_ID
  const parsedWindow = Number.parseInt(
    env.GARDEN_MODEL_CONTEXT_WINDOW_TOKENS ?? '',
    10,
  )
  const wanted =
    Number.isFinite(parsedWindow) && parsedWindow > 0
      ? parsedWindow
      : DEFAULT_CONTEXT_WINDOW_TOKENS
  // Ollama's native API lives at the server root, beside the /v1 alias.
  const origin = URL.canParse(baseUrl) ? new URL(baseUrl).origin : null
  if (!origin) return Promise.resolve(null)

  const json = (response) => (response.ok ? response.json() : null)
  return fetchImpl(`${origin}/api/version`)
    .then(json)
    .then((version) => {
      if (!version?.version) return null
      // Loading the model makes Ollama report the context it actually uses.
      return fetchImpl(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: '10m' }),
      })
        .then(() => fetchImpl(`${origin}/api/ps`))
        .then(json)
        .then((ps) => {
          const loaded = ps?.models?.find(
            (entry) => entry.name === model || entry.model === model,
          )
          const actual = loaded?.context_length
          if (typeof actual !== 'number' || actual >= wanted) return null
          return formatWarning({ model, actual, wanted })
        })
    })
    .catch(() => null)
}

function formatWarning({ model, actual, wanted }) {
  return [
    '',
    `⚠ Ollama is serving ${model} with a ${actual}-token context; Garden expects ${wanted}.`,
    '  Ollama silently truncates longer prompts, so chats lose their instructions and tools.',
    `  Restart Ollama with OLLAMA_CONTEXT_LENGTH=${wanted}:`,
    `    native app or CLI:  OLLAMA_CONTEXT_LENGTH=${wanted} ollama serve`,
    '    Docker:             pnpm offline:up:ollama (compose.dev.yaml sets it)',
    '  See README "Offline mode" for the macOS app and Homebrew service.',
    '',
  ].join('\n')
}
