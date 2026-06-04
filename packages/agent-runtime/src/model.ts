import type { LanguageModel } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'

const DEFAULT_AI_GATEWAY_ID = 'garden-staging'
const AGENT_MODEL_ID = '@cf/moonshotai/kimi-k2.6'

type AgentModelConfig = {
  ai: Ai
  gatewayId?: string
}

/**
 * Uses the Cloudflare Workers AI binding so deployed agents do not need a
 * dashboard-provided account id or API token. Cloudflare AI Gateway docs note
 * Worker binding calls are pre-authenticated inside the account, but non-default
 * Gateway IDs must exist before use; Alchemy owns the `garden-staging` gateway
 * in the staging deploy graph and exposes its id as an env binding.
 */
export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const workersai = createWorkersAI({
    binding: config.ai,
    gateway: { id: config.gatewayId ?? DEFAULT_AI_GATEWAY_ID },
  })

  return workersai(AGENT_MODEL_ID)
}
