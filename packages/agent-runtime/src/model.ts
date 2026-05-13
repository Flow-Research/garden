import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import type { LanguageModel } from 'ai'

const AI_GATEWAY_ID = 'garden'
const AGENT_MODEL_ID = 'workers-ai/@cf/moonshotai/kimi-k2.6'

type AgentModelConfig = {
  accountId: string
  apiKey: string
}

export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const aigateway = createAiGateway({
    accountId: config.accountId,
    gateway: AI_GATEWAY_ID,
    apiKey: config.apiKey,
  })
  const unified = createUnified()

  return aigateway(unified(AGENT_MODEL_ID))
}
