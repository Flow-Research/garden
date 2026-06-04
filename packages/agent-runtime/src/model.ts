import type { LanguageModel } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'

const AI_GATEWAY_ID = 'default'
const AGENT_MODEL_ID = '@cf/moonshotai/kimi-k2.6'

type AgentModelConfig = {
  ai: Ai
}

/**
 * Uses the Cloudflare Workers AI binding so deployed agents do not need a
 * dashboard-provided account id or API token. Cloudflare AI Gateway docs note
 * Worker binding calls are pre-authenticated inside the account and auto-create
 * the default gateway on first use, which preserves observability without
 * manual gateway provisioning or brittle runtime secrets.
 */
export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const workersai = createWorkersAI({
    binding: config.ai,
    gateway: { id: AI_GATEWAY_ID },
  })

  return workersai(AGENT_MODEL_ID)
}
