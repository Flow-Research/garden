import type { LanguageModel } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'

const DEFAULT_AI_GATEWAY_ID = 'garden-staging'

export type AgentModelProvider = 'workers-ai'

export type AgentModelCompactionPolicy = {
  responseReserveTokens: number
  tailTokenBudgetTokens: number
  thresholdTokens: number
}

export type AgentModelProfile = {
  contextWindowTokens: number
  docs: string
  id: string
  provider: AgentModelProvider
  compaction: AgentModelCompactionPolicy
}

type AgentModelConfig = {
  ai: Ai
  gatewayId?: string
  profile?: AgentModelProfile
}

const PI_DEFAULT_RESPONSE_RESERVE_TOKENS = 16_384
const PI_DEFAULT_COMPACTION_TAIL_TOKENS = 20_000

/**
 * Builds the pi-style context management policy for a model profile: compact
 * when context exceeds model window minus response reserve, while preserving a
 * recent tail verbatim. Keeping this policy construction separate from the
 * concrete model id makes future model swaps a registry update instead of a
 * runtime rewrite. Source: pi `docs/compaction.md`.
 */
function createPiStyleCompactionPolicy(
  contextWindowTokens: number,
): AgentModelCompactionPolicy {
  return {
    responseReserveTokens: PI_DEFAULT_RESPONSE_RESERVE_TOKENS,
    tailTokenBudgetTokens: PI_DEFAULT_COMPACTION_TAIL_TOKENS,
    thresholdTokens: contextWindowTokens - PI_DEFAULT_RESPONSE_RESERVE_TOKENS,
  }
}

export const agentModelProfiles = {
  kimiK26WorkersAi: {
    contextWindowTokens: 262_144,
    docs: 'Cloudflare Workers AI model docs: @cf/moonshotai/kimi-k2.6 context window is 262,144 tokens.',
    id: '@cf/moonshotai/kimi-k2.6',
    provider: 'workers-ai',
    compaction: createPiStyleCompactionPolicy(262_144),
  },
} as const satisfies Record<string, AgentModelProfile>

export type AgentModelProfileKey = keyof typeof agentModelProfiles

const DEFAULT_AGENT_MODEL_PROFILE_KEY = 'kimiK26WorkersAi'

export function getDefaultAgentModelProfile(): AgentModelProfile {
  return agentModelProfiles[DEFAULT_AGENT_MODEL_PROFILE_KEY]
}

/**
 * Creates the Garden runtime model from a profile. Today all runtime agents use
 * Workers AI Kimi K2.6; callers can pass a different profile later without
 * touching compaction or context-overflow plumbing.
 */
export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const profile = config.profile ?? getDefaultAgentModelProfile()
  const workersai = createWorkersAI({
    binding: config.ai,
    gateway: { id: config.gatewayId ?? DEFAULT_AI_GATEWAY_ID },
  })

  return workersai(profile.id)
}
