import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

const AGENT_MODEL_ID = '@cf/moonshotai/kimi-k2.6'

type AgentModelConfig = {
  accountId: string
  apiKey: string
}

export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const workersAi = createOpenAICompatible({
    name: 'cloudflare-workers-ai',
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`,
    apiKey: config.apiKey,
  })

  return workersAi(AGENT_MODEL_ID)
}
