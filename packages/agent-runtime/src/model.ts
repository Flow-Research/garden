import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import type { LanguageModel } from 'ai'

const CLOUDFLARE_AI_GATEWAY = 'openclaw'
const AGENT_MODEL_ID = 'workers-ai/@cf/moonshotai/kimi-k2.6'

type AgentModelConfig = {
  accountId: string
  apiKey: string
}

export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const aiGateway = createAiGateway({
    accountId: config.accountId,
    gateway: CLOUDFLARE_AI_GATEWAY,
    apiKey: config.apiKey,
  })
  const unified = createUnified()

  return aiGateway(unified(AGENT_MODEL_ID))
}
