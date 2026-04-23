import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export function createPrimaryAgentModel(apiKey: string): LanguageModel {
  const opencodeGo = createOpenAICompatible({
    name: 'opencode-go',
    baseURL: 'https://opencode.ai/zen/go/v1',
    apiKey,
  })

  return opencodeGo('kimi-k2.5')
}
